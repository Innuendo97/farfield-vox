import {
  BackSide, BoxGeometry, GLSL3, Matrix4, Mesh, ShaderMaterial, Vector2, Vector3, Vector4,
} from 'three';
import { SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS } from '../../core/sky.js';
import { FACE_LIGHT_GLSL, faceLightUniforms } from '../face-light.js';
import { FOG_GLSL, GROUND_EXPOSURE, fogUniforms } from '../air.js';
import TERRAIN from '../../../assets-src/terrain/terrain.json' with { type: 'json' };
import { MANTO, SUN_STEPS } from './worldgen.js';
import { PIGMENT_GLSL, pigmentUniforms, refreshPigment } from './pigment.js';
import { SHEET_GLSL, sheetArray, sheetUniforms } from './sheet.js';
import { bladeSettings, earthSettings, voxelSettings } from './material.js';
import {
  CAMPO, CAMPO_ATLAS, CAMPO_CUT_GLSL, campoCutUniform,
} from './campo.js';

// THE FIELD'S OWN MATERIAL: ONE BOX, ONE FRAGMENT A PIXEL, AND THE WORLD
// REBUILT BY A RAY INSTEAD OF BY A VERTEX.
//
// ===========================================================================
// WHY THIS FILE EXISTS AT ALL, IN THE UNITS THE ARGUMENT WAS WON IN.
//
// The mat of grass costs 6.3 ms of the high tier's frame as geometry and 2.9
// without multisampling, because it is 172 608 triangles of five pixels each
// and every one of them is a BORDER -- and a border is what multisampling
// charges for. A pixel of meadow at six metres crosses three to six walls
// before it finds the one that wins. The field has an overdraw of exactly ONE:
// a box, a fragment, a ray, and the first solid the ray meets. Measured in the
// prototype of U-PERF-A it draws the same meadow WITH ITS GROUND, ITS MOUNDS
// AND ITS CORRIDOR for about three milliseconds and -- this is the part
// E-DECISIONI13 rests on -- it costs the SAME at twenty five metres with
// 691 374 blades as at fourteen with 204 052, because the cost is per pixel and
// the pixels of meadow are the same pixels.
//
// ===========================================================================
// WHAT IS FAITHFULLY THE SAME AS THE CUBES, AND IT IS EVERY TERM.
//
// The one risk this technique carries is that the field stops reading as VOXEL.
// So nothing here is a new opinion about how a face looks. The joint, the
// lightened arris, the sheet of grain, the pigment, the bounce into the flanks,
// the fall under the canopy, the survival of the sun under the shadow line and
// the air are the same lines of ./material.js acting on the same literals, with
// the position they act on coming off the ray's hit instead of off a varying.
// Where a term needs a number the greedy takes from a settings object, the
// number is READ OUT OF THAT OBJECT here (bladeSettings(), earthSettings(),
// voxelSettings()) rather than written again, so a sweep that moves the cubes
// moves the field with them and neither can drift.
//
// THE ONE THING THAT IS NOT READ BUT RE-DERIVED IS THE SHADOW, AND IT IS THE
// SAME MARCH. ./worldgen.js bakes where the sun stops reaching each blade
// column by walking SUN_STEPS along the seal's own bearing and taking the
// highest neighbour dropped by how far the beam has climbed. The field walks
// the identical eight steps over the identical heights in the identical unit at
// the moment it shades. It is not a copy of the bake: it is the bake's own loop
// over a picture that already holds every height it reads. What it buys is that
// the line follows the sun instead of being cooked at one hour, and what it
// costs was measured at nought in the prototype.
//
// ===========================================================================
// THE THREE THINGS TO KNOW BEFORE READING THE LOOP.
//
// 1. THE TRAVERSAL IS AMANATIDES & WOO OVER A PYRAMID OF MAXIMA (Tevs 2008):
//    the ray steps cell to cell exactly, and where a coarse cell's maximum is
//    under it the whole cell is skipped and the ray climbs a level; where it is
//    not, it descends. That is what makes the far field cost what the near does.
// 2. THE LEVEL OF DETAIL IS PER PIXEL AND NOT PER CHUNK. The finest level a ray
//    may stop at is chosen from how far it has travelled -- five centimetres
//    inside eight metres (D-P3), then ten, then twenty. There is no seam
//    because there is no mesh to cut, and the threshold itself is dithered per
//    pixel so that even it has no line on it.
// 3. THE DEPTH IS WRITTEN, so the flowers, the avatar and the feet of the
//    monoliths cut into the blades per pixel. It costs this draw its early
//    depth test, so it is a DEFINE and not a uniform: a program that writes
//    gl_FragDepth anywhere has lost the early test whatever the branch decides,
//    and a cost that cannot be turned off cannot be measured.
// ===========================================================================

const SCRATCH = new Vector2();

/** The eight steps of the sun's march, as the shader is handed them. */
const SUN_MARCH = SUN_STEPS.map((s) => new Vector3(s.di, s.dj, s.rise));

const VERTEX = /* glsl */`
  out vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */`
  precision highp float;
  precision highp int;

  in vec3 vWorld;
  out vec4 fragColour;

  uniform sampler2D tField;
  // Where each level of the pyramid stands in the one picture that carries them
  // all. Whole numbers, held as floats because that is the array a renderer
  // uploads without a second thought about integer uniforms.
  uniform vec2 uLevelOrigin[${CAMPO.levels}];
  // The window's own bounds in the world, which is where the ray must stop: the
  // address of a texel is toroidal, so a step past the edge comes back in on
  // the other side and would draw a copy of somewhere else.
  uniform vec4 uBounds;
  uniform vec2 uHeight;
  uniform float uCell;
  uniform float uUnit;
  uniform int uSteps;
  uniform int uTopLevel;
  uniform vec2 uLod;
  uniform float uHorizon;
  uniform vec3 uSunMarch[${SUN_MARCH.length}];
  uniform float uDebug;
  // How much ground one screen pixel covers at one metre, head on. See the note
  // over the footprint in main() for why it is a uniform and not an fwidth.
  uniform float uPixelScale;
  uniform mat4 uViewProjection;

  // The families' own numbers, read out of the settings objects of
  // ./material.js and never written again here.
  uniform vec3 uAlbedoEarth;
  uniform float uHueEarth;
  uniform vec2 uSheetLayerEarth;
  uniform vec2 uSheetGainEarth;
  uniform float uJoint;
  uniform float uJointPixels;
  uniform float uArris;
  uniform float uArrisPixels;
  uniform float uArrisLean;
  uniform float uBounce;
  uniform vec2 uBase;
  uniform float uShadeSun;

  ${SCENE_LIGHT_GLSL}
  ${FACE_LIGHT_GLSL}
  ${PIGMENT_GLSL}
  ${SHEET_GLSL}
  ${FOG_GLSL}
  ${CAMPO_CUT_GLSL}

  const int SIDE = ${CAMPO.side};
  // A whole number of every level's own wrap, added before the mask so that a
  // negative cell index -- the blade lattice is the world's, and the world has
  // plenty of them -- never reaches a bitwise operator as a negative number.
  const int WRAP_BIAS = ${CAMPO.side * CAMPO.side};
  // The narrowest a blade may stand, in eighths of its cell, from the law that
  // decides it rather than from a number written twice.
  const float SLIM_LOW = ${MANTO.slim.low.toFixed(1)};

  vec4 cellAt(ivec2 cell, int level) {
    int mask = (SIDE >> level) - 1;
    ivec2 t = ivec2((cell.x + WRAP_BIAS) & mask, (cell.y + WRAP_BIAS) & mask);
    return texelFetch(tField, ivec2(uLevelOrigin[level]) + t, 0);
  }

  // WHERE THE SUN STOPS REACHING A COLUMN, in the store's own unit, walked at
  // the moment of shading over the very heights the picture holds.
  //
  // This is bakeShade() of ./worldgen.js line for line: start at the column's
  // own floor, take the highest neighbour along the march dropped by how far
  // the beam has climbed to reach it, and FLOOR the answer -- a line half a
  // quarter-blade high is a line the quarter-blade below it is still lit at,
  // and rounding up would darken a cube the sun does reach. A column that is
  // not there casts nothing and its step passes.
  float sunLineAt(ivec2 column, float floorUnits) {
    float line = floorUnits;
    for (int k = 0; k < ${SUN_MARCH.length}; k++) {
      vec3 s = uSunMarch[k];
      vec4 t = cellAt(column + ivec2(s.xy), 0);
      if (t.b == 0.0) continue;
      float h = t.r * 255.0 - s.z;
      if (h > line) line = h;
    }
    return floor(line);
  }

  // The grain inside a face, with the family's own slice and gain handed in:
  // sheetGrain() of ./sheet.js reads them off uniforms because a greedy
  // material is one family and this program is three. The arithmetic, the lay
  // and the footprint are that file's, unchanged.
  float grainOf(vec3 p, vec3 n, float pixel, vec2 draw, vec2 layers, vec2 gains) {
    float top = step(0.5, abs(n.y));
    float layer = mix(layers.y, layers.x, top);
    float gain = mix(gains.y, gains.x, top) * uSheetOn;
    vec2 uv = sheetLay(sheetFaceUv(p, n, uCell), draw);
    return max(0.0, 1.0 + gain * (sheetGrey(uv, layer, pixel / uCell) - 0.5));
  }

  // The mat's own pair, bent exactly as matTerms() of ./material.js bends it:
  // the bounce raises the SKY term of a flank, and each loss goes on the term
  // it is about so a shaded face is never charged for its lost sun twice.
  vec2 matTerms(vec3 nn, float sun, float sky, float bounce) {
    vec2 pair = faceTerms(nn);
    pair.y = min(1.0, pair.y + bounce * (1.0 - abs(nn.y)));
    return vec2(pair.x * sun, pair.y * sky);
  }

  void main() {
    vec3 eye = cameraPosition;
    vec3 dir = normalize(vWorld - eye);
    // No axis exactly nought, so that every reciprocal below is a number: a
    // ray straight down the y axis would otherwise never leave its own column.
    dir.x = abs(dir.x) < 1e-6 ? 1e-6 : dir.x;
    dir.z = abs(dir.z) < 1e-6 ? 1e-6 : dir.z;
    dir.y = abs(dir.y) < 1e-6 ? 1e-6 : dir.y;
    vec3 inv = 1.0 / dir;

    // WHERE THE RAY ENTERS THE WINDOW. The box draws its BACK faces so that the
    // walker may stand inside it -- which they do the moment they climb a mound
    // -- and a front face would then be culled and the ground would vanish from
    // under their feet. So the entry is solved and not interpolated.
    vec3 lo = vec3(uBounds.x, uHeight.x, uBounds.y);
    vec3 hi = vec3(uBounds.z, uHeight.y, uBounds.w);
    vec3 a = (lo - eye) * inv;
    vec3 b = (hi - eye) * inv;
    vec3 nearT = min(a, b);
    vec3 farT = max(a, b);
    float tEnter = max(max(nearT.x, nearT.y), max(nearT.z, 0.0));
    float tLeave = min(farT.x, min(farT.y, farT.z));

    // AND WHERE THE FIELD OWNS THE RAY AT ALL, CLIPPED AS AN INTERVAL AND NOT
    // TESTED AT THE HIT. The line between the two representations is a vertical
    // plane, so a ray crosses it at most once: solving for that crossing keeps
    // the field from marching pixels the cubes are going to draw, which is what
    // makes the two halves of the frame a comparison of COSTS and not of one
    // cost plus the other's shadow.
    if (uCut.w > 0.5) {
      float s0 = campoSide(eye.xz);
      float sd = dot(uCut.xy, dir.xz);
      if (abs(sd) < 1e-9) {
        if (s0 < 0.0) discard;
      } else if (sd > 0.0) tEnter = max(tEnter, -s0 / sd);
      else tLeave = min(tLeave, -s0 / sd);
    }
    if (tLeave <= tEnter) discard;

    vec3 p = eye + dir * (tEnter + 1e-4);

    // THE LEVEL OF DETAIL, PER PIXEL AND DITHERED. The threshold is jittered by
    // a tenth of its own distance out of the pixel's own hash, so the place
    // where five centimetre cells give way to ten has no line on it: the two
    // levels interleave over a band instead of meeting at an edge. It is the
    // cheap half of Cesium's screen space cross fade -- one hash, no second
    // draw, nothing to sort.
    float dither = 0.9 + 0.2 * pigHash(gl_FragCoord.x, gl_FragCoord.y);
    vec2 lod = uLod * dither;

    vec2 sgn = sign(dir.xz);
    int level = uTopLevel;
    vec3 n = vec3(0.0, 1.0, 0.0);
    vec3 hit = vec3(0.0);
    ivec2 hitCell = ivec2(0);
    vec4 tex = vec4(0.0);
    bool found = false;
    bool blade = false;
    int used = 0;

    for (int i = 0; i < 512; i++) {
      if (i >= uSteps) break;
      used = i;
      float travelled = distance(p, eye);
      int floorLevel = travelled < lod.x ? 0 : (travelled < lod.y ? 1
        : (travelled < 2.0 * lod.y ? 2 : (travelled < 4.0 * lod.y ? 3 : 4)));
      floorLevel = min(floorLevel, uTopLevel);
      float span = uCell * exp2(float(level));
      ivec2 cell = ivec2(floor(p.xz / span));
      vec2 edge = (vec2(cell) + max(sgn, 0.0)) * span;
      vec2 crossing = (edge - p.xz) * inv.xz;
      float tExit = max(min(crossing.x, crossing.y), 0.0);
      vec4 t = cellAt(cell, level);
      float topY = t.r * 255.0 * uUnit;
      float yExit = p.y + dir.y * tExit;
      bool maybe = t.b > 0.0 && (p.y <= topY + 1e-5 || yExit <= topY);
      if (maybe && level > floorLevel) { level--; continue; }
      if (maybe) {
        // ------------------------------------------------- the finest level
        float groundY = t.g * 255.0 * uUnit;
        int packed = int(t.b * 255.0 + 0.5);
        // INSIDE THE GROUND: the ray came in through a wall of the column, so
        // the face it stands on is the one it crossed to get here.
        if (p.y <= groundY + 1e-5) {
          hit = p; hitCell = cell; tex = t; found = true; blade = false; break;
        }
        // THE BLADE, WHICH IS A BOX AND NOT A HEIGHTFIELD WHERE IT IS NARROW.
        // «larghezza da 3/4 a 1 voxel completo» (E-DECISIONI10 G3): a blade
        // narrower than its cell shows all four flanks for their whole height,
        // and the greedy cuts it out of the merge for exactly that reason. So
        // the ray has to miss it laterally where the cubes have air.
        int slim = (packed >> 2) & 3;
        float inset = (level == 0 && slim > 0)
          ? uCell * (1.0 - (float(slim) + SLIM_LOW - 1.0) / 8.0) * 0.5 : 0.0;
        if (topY > groundY) {
          if (inset > 0.0) {
            vec3 blo = vec3(float(cell.x) * span + inset, groundY,
                            float(cell.y) * span + inset);
            vec3 bhi = vec3(float(cell.x + 1) * span - inset, topY,
                            float(cell.y + 1) * span - inset);
            vec3 ba = (blo - p) * inv;
            vec3 bb = (bhi - p) * inv;
            vec3 bn = min(ba, bb);
            vec3 bf = max(ba, bb);
            float t0 = max(max(bn.x, bn.y), max(bn.z, 0.0));
            float t1 = min(bf.x, min(bf.y, bf.z));
            if (t1 >= t0 && t0 <= tExit) {
              // Which slab won the entry is which face was crossed.
              vec3 nb = n;
              if (t0 > 0.0) {
                if (bn.x >= bn.y && bn.x >= bn.z) nb = vec3(-sgn.x, 0.0, 0.0);
                else if (bn.y >= bn.z) nb = vec3(0.0, -sign(dir.y), 0.0);
                else nb = vec3(0.0, 0.0, -sgn.y);
              }
              n = nb;
              hit = p + dir * t0; hitCell = cell; tex = t;
              found = true; blade = true; break;
            }
          } else if (p.y <= topY + 1e-5) {
            hit = p; hitCell = cell; tex = t; found = true; blade = true; break;
          } else if (yExit <= topY) {
            hit = p + dir * ((topY - p.y) * inv.y);
            n = vec3(0.0, 1.0, 0.0);
            hitCell = cell; tex = t; found = true; blade = true; break;
          }
        }
        // AND THE GROUND'S OWN TOP, under the blade or where none stands.
        if (yExit <= groundY) {
          hit = p + dir * ((groundY - p.y) * inv.y);
          n = vec3(0.0, 1.0, 0.0);
          hitCell = cell; tex = t; found = true; blade = false; break;
        }
      }
      // The cell is empty as far as the ray goes: cross it and climb.
      n = crossing.x < crossing.y ? vec3(-sgn.x, 0.0, 0.0) : vec3(0.0, 0.0, -sgn.y);
      p += dir * (tExit + 1e-4);
      // PAST THE FAR WALL OF THE WINDOW, and the comparison is against the
      // parameter along the ray and not against the length of the interval:
      // tLeave is measured from the EYE, so a window entered fourteen metres
      // out would otherwise be abandoned after the six metres it is deep.
      if (distance(p, eye) > tLeave) break;
      if (p.x < uBounds.x || p.z < uBounds.y || p.x > uBounds.z || p.z > uBounds.w
        || p.y < uHeight.x || p.y > uHeight.y) break;
      level = min(level + 1, uTopLevel);
    }

    if (!found) {
      if (uDebug > 1.5) { fragColour = vec4(1.0, 0.0, 1.0, 1.0); return; }
      discard;
    }
    int packed = int(tex.b * 255.0 + 0.5);
    int family = packed & 3;
    // THE CORRIDOR IS CARRIED AND NOT DRAWN (E-SENT4). Its stone is three baked
    // maps and a law of slabs that belong to src/world/path.js; the field stops
    // on it at exactly the right height and stands aside, so the family that
    // owns it draws it and nothing is painted over it.
    if (family == 2) discard;
    // AND A BLADE IS THE MAT'S FAMILY WHATEVER IT STANDS ON, which is the one
    // thing the material of a column does NOT decide.
    //
    // The mat lays on grass AND on the bare earth of a verge (MANTO.onVerge:
    // «blades thinning and shortening INTO the corridor» is what takes the netto
    // confine verde out of the picture), and the greedy draws every one of them
    // through ONE material with the meadow's own albedo -- bladeSettings() is
    // voxelSettings() with three light terms moved and the pigment untouched. A
    // field that read the family off the column would paint the blades on a
    // verge, on a mound's bank and in the halo round a boulder with the EARTH's
    // albedo and the EARTH's sheet: measured on the frame, a whole meadow of
    // tan tops and grey-blue flanks where the cubes draw grass. So the family is
    // the GROUND's question, and a blade never asks it.
    bool earth = !blade && family == 1;

    // ---------------------------------------------- how big a pixel is here
    // AN ANALYTIC FOOTPRINT AND NOT AN fwidth, AND THE REASON IS THE
    // SILHOUETTE. Every term with a width -- the joint, the arris, the level of
    // the sheet -- is held in PIXELS, so all three have to know how much ground
    // one covers. On a rasterised face that comes off the derivative of a
    // smooth position; here the position jumps by the whole depth of the scene
    // at every edge of every blade, and a width built on that derivative would
    // erase the joint along exactly the edges the eye reads a cube by. So it is
    // solved from the distance and the face's own lean, which is what the
    // derivative would have measured had the surface been continuous.
    float travelled = distance(hit, eye);
    float lean = max(0.15, abs(dot(n, dir)));
    float pixel = max(travelled * uPixelScale / lean, 1e-6);
    float onScreen = uCell / pixel;

    // A nudge inside the solid, so the wrapped coordinates below land in the
    // cube that was hit and not in the one across the face from it.
    vec3 p3 = hit - n * (uCell * 1e-3);
    vec3 cell3 = vec3(float(hitCell.x), floor(p3.y / uCell), float(hitCell.y));
    // The pigment's own column, which is the world's ten centimetre column and
    // not the blade: a zone of the world is one zone whichever family stands in
    // it. This is uCellRatio of ./material.js, written for one family.
    vec2 column = floor(cell3.xz * 0.5);

    // ------------------------------------------------------------ the pigment
    // THE TINT COMES OUT OF THE TEXEL AND THE HUE OUT OF THE FIELD. The worker
    // wrote pigTint() at this very column into the alpha of the same fetch that
    // carried the height (§2.4 of the performance dossier: one producer for a
    // texel), so the LEVEL of the colour is the store's own answer, to a byte.
    // What is left in the fragment is the hue, which rides the slow octave and
    // is a second field rather than a second sampling of this one -- and it is
    // called out of ./pigment.js rather than spelled again here.
    float tint = uTintFloor + tex.a * (uTintCeil - uTintFloor);
    vec3 albedo = (earth ? uAlbedoEarth : uAlbedo) * tint
      * pigHueOf(column.x, column.y, earth ? uHueEarth : uHue);

    // ------------------------------------------------------------- the grain
    albedo *= grainOf(p3, n, pixel, vec2(
      pigHash(cell3.x + 131.0, cell3.z + cell3.y * 17.0 + 57.0),
      pigHash(cell3.z + 401.0, cell3.x + cell3.y * 29.0 + 233.0)),
      earth ? uSheetLayerEarth : uSheetLayer,
      earth ? uSheetGainEarth : uSheetGain);

    // ------------------------------------------------------------- the joint
    vec3 middle = abs(fract(p3 / uCell) - 0.5);
    vec3 across = mix(middle, vec3(0.5), abs(n));
    float border = (0.5 - max(across.x, max(across.y, across.z))) * uCell;
    float width = min(uJointPixels * pixel, uCell * 0.14);
    albedo *= 1.0 - uJoint * (1.0 - smoothstep(0.0, width, border))
      * smoothstep(2.5, 5.0, onScreen);

    // ------------------------------------------------------------- the light
    // The two lines the mat is lit between, and BOTH come out of the picture
    // rather than out of a second store: the canopy is the top of this column,
    // and the sun's line is the march above over the same heights.
    vec4 here = cellAt(hitCell, 0);
    float canopy = here.r * 255.0 * uUnit;
    float sunLine = uHorizon > 0.5 ? sunLineAt(hitCell, here.g * 255.0) * uUnit : 0.0;
    float lightY = min(hit.y, canopy);
    float shadeSun = blade ? uShadeSun : 1.0;
    float lit = 1.0 - smoothstep(0.0, uCell * 0.25, sunLine - lightY);
    float sun = shadeSun + (1.0 - shadeSun) * lit;
    vec2 base = blade ? uBase : vec2(0.0, 1.0);
    float rung = floor(max(0.0, canopy - hit.y) / uCell);
    float sky = 1.0 - base.x * (1.0 - pow(base.y, rung));
    float bounce = blade ? uBounce : 0.0;
    vec3 light = faceLightOf(matTerms(n, sun, sky, bounce));

    // ---------------------------------------------------- the lightened arris
    float up = fract(p3.y / uCell);
    float band = min(uArrisPixels * pixel, uCell * 0.30) / uCell;
    float arris = smoothstep(1.0 - band, 1.0, up)
      * (1.0 - abs(n.y)) * uArris * smoothstep(2.5, 5.0, onScreen);
    if (arris > 0.0) {
      vec3 leaning = normalize(mix(n, normalize(n + vec3(0.0, 1.0, 0.0)), uArrisLean));
      light = mix(light, faceLightOf(matTerms(leaning, sun, sky, bounce)), arris);
    }

    vec3 colour = albedo * light;
    colour = mix(colour, uFogColour, fogAmount(travelled, hit.y));
    if (uDebug > 0.5 && uDebug < 1.5) colour = vec3(float(used) / float(uSteps));
    fragColour = vec4(colour, 1.0);

#ifdef CAMPO_DEPTH
    // THE DEPTH, so everything else in the world cuts into the blades per pixel:
    // a flower's stem, the walker's own feet, the foot of a monolith. It costs
    // this draw its early depth test, which is why it is a define -- a program
    // that writes gl_FragDepth at all has lost the early test whatever a branch
    // decides, so a cost that could not be compiled away could not be measured.
    vec4 clip = uViewProjection * vec4(hit, 1.0);
    gl_FragDepth = (clip.z / clip.w) * 0.5 + 0.5;
#endif
  }
`;

/**
 * The field's material: one program, three families, every literal read from
 * the seat that measured it.
 *
 * @param {object} options
 * @param {object} options.texture  the live clipmap's own texture
 * @param {object} options.sheets   THE ARRAY TEXTURE the cubes are already
 *                                  reading, shared by reference and not the
 *                                  delivered strip: sheetArray() is what cuts
 *                                  the strip into four slices, and a program
 *                                  handed the strip itself would bind a flat
 *                                  picture to a sampler that wants an array.
 *                                  Nought builds a neutral one, which is the
 *                                  world that shipped before the grain existed.
 * @param {boolean} options.depth   write gl_FragDepth. False prices what the
 *                                  early depth test on this draw is worth.
 */
export function campoMaterial({ texture, sheets = null, depth = true } = {}) {
  const blade = bladeSettings();
  const earth = earthSettings();
  const ground = voxelSettings();
  const sheet = sheets ?? sheetArray(null);
  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    defines: depth ? { CAMPO_DEPTH: '1' } : {},
    uniforms: {
      tField: { value: texture },
      uLevelOrigin: { value: CAMPO_ATLAS.origins.map((o) => new Vector2(o.x, o.y)) },
      uBounds: { value: new Vector4(0, 0, 0, 0) },
      uHeight: { value: new Vector2(-0.05, 1.6) },
      uCell: { value: CAMPO.cell },
      uUnit: { value: CAMPO.unit },
      uSteps: { value: 64 },
      uTopLevel: { value: 4 },
      // D-P3, the coordinator's own answer: eight metres of five centimetre
      // cells round the walker, then ten, then twenty.
      uLod: { value: new Vector2(8, 16) },
      uHorizon: { value: 1 },
      uSunMarch: { value: SUN_MARCH },
      uDebug: { value: 0 },
      uPixelScale: { value: 0.002 },
      uViewProjection: { value: new Matrix4() },
      // The meadow's own pigment, shared with the cubes by construction: these
      // are voxelSettings()' numbers and not a second table.
      uAlbedo: { value: ground.albedo },
      ...pigmentUniforms(ground),
      uAlbedoEarth: { value: earth.albedo },
      uHueEarth: { value: earth.hue },
      ...sheetUniforms(sheet, blade.sheetLayers, blade.sheetGain),
      uSheetLayerEarth: { value: earth.sheetLayers },
      uSheetGainEarth: { value: earth.sheetGain },
      uJoint: { value: blade.joint },
      uJointPixels: { value: blade.jointPixels },
      uArris: { value: blade.arris },
      uArrisPixels: { value: blade.arrisPixels },
      uArrisLean: { value: blade.arrisLean },
      uBounce: { value: blade.bounce },
      uBase: { value: blade.base },
      uShadeSun: { value: blade.shadeSun },
      ...faceLightUniforms(TERRAIN.lightScale * GROUND_EXPOSURE),
      ...SCENE_LIGHT_UNIFORMS,
      ...fogUniforms(),
      ...campoCutUniform(),
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    // BACK FACES, so the box still draws when the walker is inside it: the eye
    // stands 1.6 m up and a mound with a blade on it reaches past that.
    side: BackSide,
    fog: false,
    depthWrite: true,
    depthTest: true,
  });
  material.userData.refresh = () => {
    const now = bladeSettings();
    const u = material.uniforms;
    refreshPigment(u, voxelSettings());
    u.uJoint.value = now.joint;
    u.uArris.value = now.arris;
    u.uArrisLean.value = now.arrisLean;
    u.uBounce.value = now.bounce;
    u.uBase.value.copy(now.base);
    u.uShadeSun.value = now.shadeSun;
  };
  return material;
}

/**
 * The one box the field is drawn on.
 *
 * A unit of the world scaled by its model matrix and moved with the window,
 * never rebuilt: the geometry is four hundred bytes and where it stands is a
 * matrix, so following the walker costs no upload at all.
 */
export function campoBox(material, onRenderer = null) {
  const side = CAMPO.side * CAMPO.cell;
  const mesh = new Mesh(new BoxGeometry(side, 1, side), material);
  mesh.name = 'ground-campo';
  // THE CAMERA AND THE RENDERER ARRIVE HERE AND NOWHERE ELSE, which is what
  // keeps the field out of src/world/hub.js. Two of this material's uniforms
  // are properties of the FRAME and not of the world -- the matrix the depth is
  // written through, and how much ground one screen pixel covers -- and a layer
  // is handed neither. three hands both to a mesh at the moment it is drawn.
  mesh.onBeforeRender = (renderer, scene, camera) => {
    const u = material.uniforms;
    u.uViewProjection.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    // The footprint of one pixel at one metre, head on: the height of the view
    // frustum at unit distance over the pixels it is drawn in. The fragment
    // divides by the face's own lean to get what an fwidth would have read.
    const size = renderer.getDrawingBufferSize(SCRATCH);
    const fov = (camera.fov ?? 45) * Math.PI / 180;
    u.uPixelScale.value = size.y > 0 ? 2 * Math.tan(fov / 2) / size.y : 0.002;
    if (onRenderer) onRenderer(renderer);
  };
  // The frustum cannot help here and can only hurt: the box is the ground the
  // walker stands in the middle of, so it is always in view, and a bounding
  // sphere recomputed as it moves is main thread work for an answer that never
  // changes.
  mesh.frustumCulled = false;
  // AFTER EVERY OTHER OPAQUE. The field writes gl_FragDepth, so it has no early
  // depth test of its own; what it can still have is everybody else's depth
  // already written, which kills its fragments behind the monoliths at the late
  // test instead of shading them.
  mesh.renderOrder = 10;
  return mesh;
}
