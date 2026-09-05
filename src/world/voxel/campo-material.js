import {
  BackSide, BoxGeometry, GLSL3, Matrix4, Mesh, ShaderMaterial, Vector2, Vector3, Vector4,
} from 'three';
import { SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS } from '../../core/sky.js';
import { FACE_LIGHT_GLSL, faceLightUniforms } from '../face-light.js';
import { FOG_GLSL, GROUND_EXPOSURE, fogUniforms } from '../air.js';
import TERRAIN from '../../../assets-src/terrain/terrain.json' with { type: 'json' };
import { EARTH, MANTO, SUN_STEPS } from './worldgen.js';
import { PIGMENT_GLSL, pigmentUniforms, refreshPigment } from './pigment.js';
import { SHEET_GLSL, sheetArray, sheetUniforms } from './sheet.js';
import { bladeSettings, earthSettings, voxelSettings } from './material.js';
import {
  CAMPO, CAMPO_BIAS, CAMPO_BLADE_CEIL, CAMPO_CUT_GLSL, CAMPO_FAR, CAMPO_FAR_SHIFT,
  CAMPO_RUNG, campoCutUniform,
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
// PHASE TWO: ONE PROGRAM, TWO WINDOWS, AND NO EDGE ANYWHERE.
//
// The ray now walks TWO pictures (see ./campo.js): the near one, five
// centimetres a texel and following the walker, and the far one, forty
// centimetres a texel and standing still over the whole world. It walks them
// with ONE level counter, because the two are exactly eight cells apart -- a
// far texel is a cell of level three of the near pyramid -- so at every level
// the two lattices are the SAME lattice and crossing between them is a change
// of which sampler answers and of nothing else. There is no blend band, no
// second draw and nothing to sort: the seam is arithmetic.
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
// AND THE WALL OF A COLUMN IS NOW THE MESHER'S OWN WALL, which phase one could
// not draw. The greedy lays a cut wall as two rectangles -- soil up to one
// voxel under the top, meadow for that last cube -- under three conditions:
// the flank is soil, the wall is at least EARTH.minStep voxels tall, and the
// face is one of the ones the target shows earth on. All three are answered
// here out of the texel and its neighbour, so a mound bank, the halo round a
// boulder and a terrace of the boundary are cut in the field exactly as the
// cubes cut them. Phase one read the family off the column's TOP and painted
// whole flanks with it, which is what the affiancato showed as «cime sabbia e
// fianchi grigio-azzurri attorno ai massi».
//
// ===========================================================================
// THE FOUR THINGS TO KNOW BEFORE READING THE LOOP.
//
// 1. THE TRAVERSAL IS AMANATIDES & WOO OVER A PYRAMID OF MAXIMA (Tevs 2008):
//    the ray steps cell to cell exactly, and where a coarse cell's maximum is
//    under it the whole cell is skipped and the ray climbs a level; where it is
//    not, it descends. That is what makes the far field cost what the near does.
// 2. THE LEVEL OF DETAIL IS THE PIXEL'S OWN FOOTPRINT AND IT IS DITHERED. The
//    finest cell a ray may stop at is the one that covers about uLodGain pixels
//    on the screen, which is a continuous number; the pixel's own hash decides
//    which side of it this pixel takes, so two levels INTERLEAVE over a band
//    instead of meeting at a line. That is a stochastic mip and it is the
//    cheapest half of the answer to the scintillation of phase one: geometry
//    finer than a pixel is not drawn at all rather than sampled once.
// 3. AND THE OTHER HALF IS MORE THAN ONE RAY. `uRays` sub-pixel samples are
//    marched through the same fragment on a rotated grid and averaged -- which
//    is the only thing that antialiases a silhouette the RAY finds, since
//    multisampling only ever antialiased the borders of the box. It is a
//    uniform because its price is the whole point: E-DECISIONI14 spends the
//    1.4 ms that dropping to two multisamples frees, and what that buys is
//    measured on the bench rather than assumed here.
// 4. THE DEPTH IS WRITTEN, so the flowers, the avatar and the feet of the
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
  uniform sampler2D tFar;
  // Where each level of each pyramid stands in the one picture that carries
  // them all. Whole numbers, held as floats because that is the array a
  // renderer uploads without a second thought about integer uniforms.
  uniform vec2 uLevelOrigin[${CAMPO.levels}];
  uniform vec2 uFarOrigin[${CAMPO_FAR.levels}];
  // The near window's own bounds in the world, which is where the ray has to
  // change picture: the address of a texel is toroidal, so a step past the edge
  // comes back in on the other side and would draw a copy of somewhere else.
  uniform vec4 uBounds;
  uniform vec4 uFarBounds;
  uniform vec2 uHeight;
  uniform float uCell;
  uniform float uGroundUnit;
  uniform float uBladeUnit;
  uniform float uBias;
  uniform float uBladeCeil;
  uniform int uSteps;
  uniform int uTopLevel;
  uniform int uStartLevel;
  uniform float uLodGain;
  uniform float uDither;
  uniform int uRays;
  uniform float uRayNear;
  uniform float uHorizon;
  uniform vec3 uSunMarch[${SUN_MARCH.length}];
  uniform float uDebug;
  // How much ground one screen pixel covers at one metre, head on. See the note
  // over the footprint in shade() for why it is a uniform and not an fwidth.
  uniform float uPixelScale;
  uniform float uSkySlope;
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
  // The mesher's own rule for when a wall shows what it is cut into.
  uniform float uEarthMinStep;
  uniform float uEarthToEye;

  ${SCENE_LIGHT_GLSL}
  ${FACE_LIGHT_GLSL}
  ${PIGMENT_GLSL}
  ${SHEET_GLSL}
  ${FOG_GLSL}
  ${CAMPO_CUT_GLSL}

  const int SIDE = ${CAMPO.side};
  const int FAR_SIDE = ${CAMPO_FAR.side};
  const int FAR_SHIFT = ${CAMPO_FAR_SHIFT};
  const int NEAR_TOP = ${CAMPO.levels - 1};
  const int FAR_TOP = ${CAMPO_FAR.levels - 1 + CAMPO_FAR_SHIFT};
  const float RUNG = ${CAMPO_RUNG.toFixed(1)};
  // A whole number of every level's own wrap, added before the mask so that a
  // negative cell index -- the blade lattice is the world's, and the world has
  // plenty of them -- never reaches a bitwise operator as a negative number.
  const int WRAP_BIAS = ${CAMPO.side * CAMPO.side};
  // The narrowest a blade may stand, in eighths of its cell, from the law that
  // decides it rather than from a number written twice.
  const float SLIM_LOW = ${MANTO.slim.low.toFixed(1)};

  // ---------------------------------------------------------------- the pair
  // What a texel says about height, in the two units it holds it in: the ground
  // in whole voxels off a biased byte, the blade in quarter-blades over it. See
  // the head of ./campo.js for why the two are not one unit any more.
  float groundYOf(vec4 t) { return (t.g * 255.0 - uBias) * uGroundUnit; }
  float topYOf(vec4 t) { return groundYOf(t) + t.r * 255.0 * uBladeUnit; }
  // And the same top in the SUB-steps the sun's own march counts in.
  float topSubOf(vec4 t) { return (t.g * 255.0 - uBias) * RUNG + t.r * 255.0; }
  float floorSubOf(vec4 t) { return (t.g * 255.0 - uBias) * RUNG; }

  // ONE FETCH, TWO PICTURES, AND THE SAME CELL INDEX FOR BOTH. At level L both
  // lattices have a cell of uCell * 2^L -- the far one because it starts eight
  // cells coarser and is asked at level L - 3 -- so the index the traversal
  // computed is the index both of them want, and the only thing that changes is
  // which sampler and which origin answer it.
  //
  // ONE RETURN AND NOT TWO, which is not a taste: the translator that turns
  // this into HLSL cannot prove that a function whose branches both return has
  // initialised its result, and warns about it on every compile. One value,
  // written on both paths, and the warning goes with the ambiguity.
  vec4 cellAt(ivec2 cell, int level, bool near) {
    int fl = near ? level : level - FAR_SHIFT;
    int mask = (near ? (SIDE >> level) : (FAR_SIDE >> fl)) - 1;
    ivec2 t = ivec2((cell.x + WRAP_BIAS) & mask, (cell.y + WRAP_BIAS) & mask);
    vec4 got = vec4(0.0);
    if (near) got = texelFetch(tField, ivec2(uLevelOrigin[level]) + t, 0);
    else got = texelFetch(tFar, ivec2(uFarOrigin[fl]) + t, 0);
    return got;
  }

  bool insideNear(vec2 xz) {
    return xz.x >= uBounds.x && xz.y >= uBounds.y && xz.x < uBounds.z && xz.y < uBounds.w;
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
  //
  // IT IS ASKED OF THE NEAR PICTURE ONLY, and that is declared rather than
  // hidden: the march's eight steps are in BLADES, and a far texel is eight
  // blades wide, so out there the neighbours it wants are not separate columns
  // at all. What the far field loses is the mat's own shadow on itself -- which
  // the greedy also loses beyond its detail ring, where a block of four blades
  // stands at one height and can shade nothing.
  float sunLineAt(ivec2 column, float floorUnits) {
    float line = floorUnits;
    for (int k = 0; k < ${SUN_MARCH.length}; k++) {
      vec3 s = uSunMarch[k];
      vec4 t = cellAt(column + ivec2(s.xy), 0, true);
      if (t.b == 0.0) continue;
      float h = topSubOf(t) - s.z;
      if (h > line) line = h;
    }
    return floor(line);
  }

  // The grain inside a face, with the family's own slice and gain handed in:
  // sheetGrain() of ./sheet.js reads them off uniforms because a greedy
  // material is one family and this program is three. The arithmetic, the lay
  // and the footprint are that file's, unchanged. The SPAN is the cell that is
  // actually being drawn and not the finest one: a grain laid at five
  // centimetres on a cube drawn at forty is a picture of a face that is not
  // there.
  float grainOf(vec3 p, vec3 n, float pixel, float span, vec2 draw,
                vec2 layers, vec2 gains) {
    float top = step(0.5, abs(n.y));
    float layer = mix(layers.y, layers.x, top);
    float gain = mix(gains.y, gains.x, top) * uSheetOn;
    vec2 uv = sheetLay(sheetFaceUv(p, n, span), draw);
    return max(0.0, 1.0 + gain * (sheetGrey(uv, layer, pixel / span) - 0.5));
  }

  // The mat's own pair, bent exactly as matTerms() of ./material.js bends it:
  // the bounce raises the SKY term of a flank, and each loss goes on the term
  // it is about so a shaded face is never charged for its lost sun twice.
  vec2 matTerms(vec3 nn, float sun, float sky, float bounce) {
    vec2 pair = faceTerms(nn);
    pair.y = min(1.0, pair.y + bounce * (1.0 - abs(nn.y)));
    return vec2(pair.x * sun, pair.y * sky);
  }

  // --------------------------------------------------------------- one ray
  // What a march comes back with. It is a struct rather than a pile of out
  // parameters because the fragment now runs it more than once.
  struct Hit {
    bool found;
    bool blade;
    bool near;
    int level;
    float t;
    vec3 p;
    vec3 n;
    ivec2 cell;
    vec4 tex;
  };

  // HOW MANY CELLS THE MARCH CROSSED, for uDebug: a picture of where the
  // traversal is expensive is the only thing that says WHICH ray is slow.
  int gSteps = 0;

  Hit march(vec3 eye, vec3 dir, vec3 inv, float tEnter, float tLeave, float dither) {
    Hit hit;
    hit.found = false;
    hit.blade = false;
    hit.near = true;
    hit.level = 0;
    hit.t = tLeave;
    hit.p = eye;
    hit.n = vec3(0.0, 1.0, 0.0);
    hit.cell = ivec2(0);
    hit.tex = vec4(0.0);

    vec3 p = eye + dir * (tEnter + 1e-4);
    vec2 sgn = sign(dir.xz);
    // WHERE THE RAY STARTS ITS PYRAMID, AND IT IS NOT THE TOP OF IT.
    //
    // Tevs starts a ray at the coarsest level and descends. That is right when
    // the pyramid is four levels deep, which is what phase one had; with the
    // far window under it the pyramid is TEN, and a ray whose first solid is
    // three metres away would pay nine descents before it could look at
    // anything. Measured on the frame that is 8 ms at the pose the campaign
    // judges on. So the ray starts LOW and CLIMBS -- one level for every empty
    // cell it crosses, which takes it from four to nine over twenty five metres
    // of open air, exactly where the coarse levels start being worth having.
    // AND A RAY THAT IS RISING STARTS AT THE TOP OF THE PYRAMID INSTEAD.
    //
    // The box is the whole world now: four hundred metres across and fifteen
    // tall, so the eye stands INSIDE it and every pixel of the sky gets a
    // fragment -- where in phase one the box was 1.65 m tall and the upper half
    // of the frame missed it entirely. A ray leaving upwards from eye height
    // cannot meet anything until the ridge, ninety metres out, because nothing
    // between here and there is taller than the eye; so it has no use for a
    // cell of eighty centimetres and every use for one of twenty five metres.
    // Started low it pays ten crossings just to climb, over half the frame.
    int level = dir.y > 0.0 ? uTopLevel : min(uStartLevel, uTopLevel);
    vec3 n = vec3(0.0, 1.0, 0.0);

    for (int i = 0; i < 512; i++) {
      if (i >= uSteps) break;
      gSteps = i;
      float travelled = distance(p, eye);
      // THE FLOOR OF THE DETAIL, AS THE PIXEL'S OWN FOOTPRINT AND DITHERED.
      // The cell the ray is allowed to stop at is the one that covers about
      // uLodGain pixels; the pixel's own hash pushes the threshold up or down
      // by up to a whole level, so the place where one level gives way to the
      // next has no line on it -- the two interleave over a band. It is the
      // cheap half of Cesium's screen space cross fade: one hash, no second
      // draw, nothing to sort.
      float want = travelled * uPixelScale * uLodGain / uCell;
      int floorLevel = int(max(0.0, floor(log2(max(want, 1.0)) + dither)));
      floorLevel = min(floorLevel, uTopLevel);
      if (level < floorLevel) level = floorLevel;
      // AND IT IS NOT CAPPED OVER THAT FLOOR, WHICH WAS TRIED AND MEASURED. A
      // descending ray pays one iteration for every level it has to come back
      // down, so holding it within three or four levels of the detail it is
      // going to stop at looks like a saving; it is not. Measured on the step
      // counter at the pose the campaign judges on, the ground went from 45.9
      // steps a pixel to 52.0 at three levels and 47.5 at four: the cells it is
      // then forced to cross are so much smaller that the crossings cost more
      // than the descents saved. The climb is worth what it costs.
      // AND WHICH PICTURE ANSWERS: the near one where the ray stands inside the
      // window it covers and the level is one it holds, the far one otherwise.
      bool near = insideNear(p.xz) && level <= NEAR_TOP;
      if (!near && level < FAR_SHIFT) {
        level = FAR_SHIFT;
        if (floorLevel < FAR_SHIFT) floorLevel = FAR_SHIFT;
      }
      float span = uCell * exp2(float(level));
      ivec2 cell = ivec2(floor(p.xz / span));
      vec2 edge = (vec2(cell) + max(sgn, 0.0)) * span;
      vec2 crossing = (edge - p.xz) * inv.xz;
      float tExit = max(min(crossing.x, crossing.y), 0.0);
      vec4 t = cellAt(cell, level, near);
      float topY = topYOf(t);
      // THE BOUND THE SKIP IS DECIDED ON, WHICH IS NOT THE SAME AS THE SURFACE.
      // A coarse cell carries the MAXIMUM ground of what is under it and a
      // SAMPLED blade over it (see campoReduce in ./campo.js: a maximum blade
      // draws a flat meadow). So what the ray may trust as "nothing under here
      // reaches past this" is the ground plus the tallest blade the law can
      // draw, and the exact tests below still use the surface itself.
      float boundY = level == 0 ? topY : groundYOf(t) + uBladeCeil;
      float yExit = p.y + dir.y * tExit;
      // AND WHERE THE CUBES OWN THE GROUND THE RAY PASSES STRAIGHT THROUGH.
      // See campoYields in ./campo.js: in the world that ships this is a
      // uniform branch that is false everywhere, and on a bench arm it is what
      // lets the greedy disc and the field be priced in ONE opening of the page
      // without either of them drawing the other's pixels.
      bool maybe = !campoYields(p.xz) && t.b > 0.0
        && (p.y <= boundY + 1e-5 || yExit <= boundY);
      if (maybe && level > floorLevel) { level--; continue; }
      if (maybe) {
        // ------------------------------------------------- the finest level
        float groundY = groundYOf(t);
        int packed = int(t.b * 255.0 + 0.5);
        // INSIDE THE GROUND: the ray came in through a wall of the column, so
        // the face it stands on is the one it crossed to get here.
        if (p.y <= groundY + 1e-5) {
          hit.found = true; hit.blade = false; hit.near = near; hit.level = level;
          hit.p = p; hit.n = n; hit.cell = cell; hit.tex = t;
          hit.t = distance(p, eye);
          return hit;
        }
        // THE BLADE, WHICH IS A BOX AND NOT A HEIGHTFIELD WHERE IT IS NARROW.
        // «larghezza da 3/4 a 1 voxel completo» (E-DECISIONI10 G3): a blade
        // narrower than its cell shows all four flanks for their whole height,
        // and the greedy cuts it out of the merge for exactly that reason. So
        // the ray has to miss it laterally where the cubes have air.
        //
        // AND THE INSET FADES WITH THE PIXEL, WHICH IS A PREFILTER AND NOT A
        // TASTE. A blade three quarters of a cell wide standing at twenty
        // metres has four flanks that are each a third of a pixel across: one
        // ray a pixel cannot resolve them and what it reports instead is noise
        // at the frequency of the pixel, which is the scintillation of phase
        // one at its source. Where the cell is no bigger than a couple of
        // pixels the blade is therefore widened back to its whole cell -- the
        // detail is not drawn rather than sampled once -- and the LOD above
        // has by then merged it into a bigger cell anyway.
        int slim = (packed >> 2) & 3;
        float thin = span / max(distance(p, eye) * uPixelScale, 1e-6);
        float inset = (level == 0 && near && slim > 0)
          ? span * (1.0 - (float(slim) + SLIM_LOW - 1.0) / 8.0) * 0.5
            * smoothstep(2.0, 5.0, thin) : 0.0;
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
              hit.found = true; hit.blade = true; hit.near = near; hit.level = level;
              hit.p = p + dir * t0; hit.n = nb; hit.cell = cell; hit.tex = t;
              hit.t = distance(hit.p, eye);
              return hit;
            }
          } else if (p.y <= topY + 1e-5) {
            hit.found = true; hit.blade = true; hit.near = near; hit.level = level;
            hit.p = p; hit.n = n; hit.cell = cell; hit.tex = t;
            hit.t = distance(p, eye);
            return hit;
          } else if (yExit <= topY) {
            hit.found = true; hit.blade = true; hit.near = near; hit.level = level;
            hit.p = p + dir * ((topY - p.y) * inv.y);
            hit.n = vec3(0.0, 1.0, 0.0);
            hit.cell = cell; hit.tex = t;
            hit.t = distance(hit.p, eye);
            return hit;
          }
        }
        // AND THE GROUND'S OWN TOP, under the blade or where none stands.
        if (yExit <= groundY) {
          hit.found = true; hit.blade = false; hit.near = near; hit.level = level;
          hit.p = p + dir * ((groundY - p.y) * inv.y);
          hit.n = vec3(0.0, 1.0, 0.0);
          hit.cell = cell; hit.tex = t;
          hit.t = distance(hit.p, eye);
          return hit;
        }
      }
      // The ray leaves this cell without stopping in it: cross it. Which parent
      // cell it was standing in is remembered first -- see the ascent rule below.
      ivec2 parentBefore = ivec2(floor(p.xz / (span * 2.0)));
      n = crossing.x < crossing.y ? vec3(-sgn.x, 0.0, 0.0) : vec3(0.0, 0.0, -sgn.y);
      p += dir * (tExit + 1e-4);
      // PAST THE FAR WALL OF THE WINDOW, and the comparison is against the
      // parameter along the ray and not against the length of the interval:
      // tLeave is measured from the EYE, so a window entered fourteen metres
      // out would otherwise be abandoned after the six metres it is deep.
      if (distance(p, eye) > tLeave) break;
      if (p.x < uFarBounds.x || p.z < uFarBounds.y
        || p.x > uFarBounds.z || p.z > uFarBounds.w
        || p.y < uHeight.x || p.y > uHeight.y) break;
      // AND IT CLIMBS ONLY WHEN IT HAS LEFT THE PARENT CELL AS WELL.
      //
      // THIS IS THE ONE LINE THE WHOLE COST OF THE FRAME WAS IN, and it is the
      // ascent rule every hierarchical traversal needs. Climbing on every
      // crossing puts the ray in a PING-PONG: at level L the cell's maximum is
      // under it, so it crosses and climbs; at L + 1 the cell is twice as long
      // and reaches far enough ahead that its maximum is NOT under it, so the
      // ray descends again without having moved. Two iterations for every cell
      // of ground, over the whole lower half of the frame. Measured on the step
      // counter, the meadow was costing fifty to seventy steps a pixel and the
      // air over it more.
      //
      // A ray may only stand at level L + 1 where it has not already looked at
      // half of that cell -- and it has not, exactly when the crossing took it
      // out of the parent. Asked that way the ascent is exact, it costs one
      // floor, and no cell is ever tested twice.
      ivec2 parentAfter = ivec2(floor(p.xz / (span * 2.0)));
      if (parentAfter != parentBefore) level = min(level + 1, min(uTopLevel, FAR_TOP));
    }
    return hit;
  }

  // ------------------------------------------------------------ one shading
  // Everything a pixel is, from a hit: the families, the pigment, the grain,
  // the joint, the light, the arris and the air. Nought alpha where the ray
  // found nothing, so a fragment that only partly covers the ground can hand
  // back the fraction it covered instead of a hard edge against the sky.
  vec4 shade(vec3 dir, Hit hit) {
    if (!hit.found) return vec4(0.0);
    int packed = int(hit.tex.b * 255.0 + 0.5);
    int family = packed & 3;
    // THE CORRIDOR IS CARRIED AND NOT DRAWN (E-SENT4). Its stone is three baked
    // maps and a law of slabs that belong to src/world/path.js; the field stops
    // on it at exactly the right height and stands aside, so the family that
    // owns it draws it and nothing is painted over it.
    if (family == 2) return vec4(0.0);

    float span = uCell * exp2(float(hit.level));
    float groundY = groundYOf(hit.tex);
    bool onTop = abs(hit.n.y) > 0.5;

    // ------------------------------------------------- WHICH FAMILY A FACE IS
    // A BLADE IS THE MAT'S FAMILY WHATEVER IT STANDS ON, which is the one thing
    // the material of a column does NOT decide: the mat lays on grass AND on
    // the bare earth of a verge (MANTO.onVerge), and the greedy draws every one
    // of them through ONE material with the meadow's own albedo.
    //
    // A TOP FACE is the column's own material.
    //
    // A WALL IS THE MESHER'S WALL, and the three conditions are its three: the
    // flank is soil (bit five of B, written by the store's own flank), the wall
    // climbs at least EARTH.minStep voxels over the ground it stands against,
    // and this face is one the target shows earth on -- south always, and east
    // or west according to which side of the corridor the column stands, which
    // is baked into bits six and seven because it is a question about the PATH
    // and not about this column's height. The top cube of such a wall keeps the
    // meadow's own flank, which is E-DECISIONI8.3 read as geometry.
    bool earth = false;
    if (!hit.blade) {
      if (onTop) {
        earth = family == 1;
      } else if ((packed & 32) != 0) {
        vec4 across = cellAt(hit.cell + ivec2(int(hit.n.x), int(hit.n.z)),
                             hit.level, hit.near);
        float rise = (hit.tex.g - across.g) * 255.0;
        bool facing = (uEarthToEye > 0.5 && hit.n.z > 0.5)
          || (hit.n.x < -0.5 && (packed & 64) != 0)
          || (hit.n.x > 0.5 && (packed & 128) != 0);
        earth = facing && across.b > 0.0 && rise >= uEarthMinStep
          && hit.p.y < groundY - uGroundUnit;
      }
    }

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
    float travelled = hit.t;
    float lean = max(0.15, abs(dot(hit.n, dir)));
    float pixel = max(travelled * uPixelScale / lean, 1e-6);
    float onScreen = span / pixel;

    // A nudge inside the solid, so the wrapped coordinates below land in the
    // cube that was hit and not in the one across the face from it.
    vec3 p3 = hit.p - hit.n * (span * 1e-3);
    vec3 cell3 = vec3(float(hit.cell.x), floor(p3.y / span), float(hit.cell.y));
    // The pigment's own column, which is the world's ten centimetre column and
    // not the blade: a zone of the world is one zone whichever family stands in
    // it. This is uCellRatio of ./material.js, written for one family.
    vec2 column = floor(p3.xz / (uCell * 2.0));

    // ------------------------------------------------------------ the pigment
    // THE TINT COMES OUT OF THE TEXEL AND THE HUE OUT OF THE FIELD. The worker
    // wrote pigTint() at this very column into the alpha of the same fetch that
    // carried the height (§2.4 of the performance dossier: one producer for a
    // texel), so the LEVEL of the colour is the store's own answer, to a byte.
    // What is left in the fragment is the hue, which rides the slow octave and
    // is a second field rather than a second sampling of this one.
    float tint = uTintFloor + hit.tex.a * (uTintCeil - uTintFloor);
    vec3 albedo = (earth ? uAlbedoEarth : uAlbedo) * tint
      * pigHueOf(column.x, column.y, earth ? uHueEarth : uHue);

    // ------------------------------------------------------------- the grain
    albedo *= grainOf(p3, hit.n, pixel, span, vec2(
      pigHash(cell3.x + 131.0, cell3.z + cell3.y * 17.0 + 57.0),
      pigHash(cell3.z + 401.0, cell3.x + cell3.y * 29.0 + 233.0)),
      earth ? uSheetLayerEarth : uSheetLayer,
      earth ? uSheetGainEarth : uSheetGain);

    // ------------------------------------------------------------- the joint
    vec3 middle = abs(fract(p3 / span) - 0.5);
    vec3 across = mix(middle, vec3(0.5), abs(hit.n));
    float border = (0.5 - max(across.x, max(across.y, across.z))) * span;
    float width = min(uJointPixels * pixel, span * 0.14);
    albedo *= 1.0 - uJoint * (1.0 - smoothstep(0.0, width, border))
      * smoothstep(2.5, 5.0, onScreen);

    // ------------------------------------------------------------- the light
    // The two lines the mat is lit between, and BOTH come out of the picture
    // rather than out of a second store: the canopy is the top of this column,
    // and the sun's line is the march above over the same heights.
    float canopy = topYOf(hit.tex);
    // AND THE SUN'S LINE IS MARCHED AT THE BLADE WHATEVER THE LEVEL OF DETAIL
    // IS, which is the same thing layMat does and for the same reason. Beyond
    // its detail ring the greedy draws a block of four blades at one height --
    // which can shade nothing, because nothing on it is taller than itself --
    // and hands the shadow back as a TEXTURE marched over the mat the LAW
    // draws. The field has that mat in the picture already, at five
    // centimetres, so it marches there: the column asked is the blade column
    // under the hit and not the coarse cell the ray stopped in. What the eye
    // gets on a plateau of blocks is the light and shade of the blades that
    // would have been there, which is exactly what the cubes give it.
    ivec2 fine = ivec2(floor(hit.p.xz / uCell));
    vec4 under = hit.level == 0 ? hit.tex : cellAt(fine, 0, true);
    float sunLine = (uHorizon > 0.5 && insideNear(hit.p.xz) && under.b > 0.0)
      ? sunLineAt(fine, floorSubOf(under)) * uBladeUnit : -1e4;
    float lightY = min(hit.p.y, canopy);
    float shadeSun = hit.blade ? uShadeSun : 1.0;
    float lit = 1.0 - smoothstep(0.0, uCell * 0.25, sunLine - lightY);
    float sun = shadeSun + (1.0 - shadeSun) * lit;
    vec2 base = hit.blade ? uBase : vec2(0.0, 1.0);
    float rung = floor(max(0.0, canopy - hit.p.y) / uCell);
    float sky = 1.0 - base.x * (1.0 - pow(base.y, rung));
    float bounce = hit.blade ? uBounce : 0.0;
    vec3 light = faceLightOf(matTerms(hit.n, sun, sky, bounce));

    // ---------------------------------------------------- the lightened arris
    float up = fract(p3.y / span);
    float band = min(uArrisPixels * pixel, span * 0.30) / span;
    float arris = smoothstep(1.0 - band, 1.0, up)
      * (1.0 - abs(hit.n.y)) * uArris * smoothstep(2.5, 5.0, onScreen);
    if (arris > 0.0) {
      vec3 leaning = normalize(mix(hit.n, normalize(hit.n + vec3(0.0, 1.0, 0.0)), uArrisLean));
      light = mix(light, faceLightOf(matTerms(leaning, sun, sky, bounce)), arris);
    }

    vec3 colour = albedo * light;
    colour = mix(colour, uFogColour, fogAmount(travelled, hit.p.y));
    return vec4(colour, 1.0);
  }

  void main() {
    vec3 eye = cameraPosition;
    vec3 dir0 = normalize(vWorld - eye);
    // A RAY THAT CANNOT REACH ANYTHING IS NOT MARCHED AT ALL.
    //
    // The box is the whole world -- four hundred metres across and fifteen
    // tall -- so the eye stands inside it and EVERY pixel of the sky gets a
    // fragment, where in phase one the box was 1.65 m tall and the upper half
    // of the frame missed it entirely. Most of those fragments cannot hit
    // anything: the plateau is level, the ridge crowns fifteen metres up and
    // sixty out, and a ray leaving the eye steeper than the steepest thing in
    // the picture is looking at sky by arithmetic.
    //
    // uSkySlope is exactly that steepness, taken every frame on the thread the
    // walker is on out of the tiles' own maxima -- sixty four numbers and the
    // distance from the eye to each tile, which is a bound and not a guess (see
    // skySlope() in ./campo-field.js). One compare, and the sky stops being
    // marched.
    if (dir0.y > uSkySlope * length(dir0.xz)) discard;
    // THE TWO SCREEN DERIVATIVES OF THE RAY, which is how a sub-pixel sample is
    // aimed without any knowledge of the projection: one pixel to the right is
    // this direction plus its own derivative, whatever lens produced it.
    vec3 ddx = dFdx(dir0);
    vec3 ddy = dFdy(dir0);

    // The pixel's own hash, used for the dither of the detail. It is a function
    // of the PIXEL and not of the frame, so a still camera draws a still
    // picture: the interleaving is spatial and never temporal.
    float dither = uDither * (pigHash(gl_FragCoord.x, gl_FragCoord.y) - 0.5) + 0.5;

    vec4 sum = vec4(0.0);
    float nearest = 1e9;
    int used = 0;
    // HOW MANY RAYS THIS PIXEL GETS, AND IT IS NOT THE SAME EVERYWHERE.
    //
    // A second ray is worth having exactly where the ray finds detail smaller
    // than the pixel, and that is the NEAR meadow: past ten metres the level of
    // detail has already merged the blades into cells bigger than a pixel and a
    // second sample of them lands on the same cell. It is also cheapest exactly
    // there -- a near hit is found in a few steps where a grazing far one is
    // found in forty -- so the rule buys the aliasing that is left at the price
    // of the marches that are short. How far "near" reaches is uRayNear, and
    // nought turns the whole thing off.
    //
    // The first ray decides for the rest, which is one branch a whole warp of
    // neighbouring pixels takes the same way.
    int rays = max(1, min(uRays, 4));
    for (int k = 0; k < 4; k++) {
      if (k >= rays) break;
      // A ROTATED GRID, which is the pattern that puts the most distinct sample
      // positions on a nearly horizontal or nearly vertical edge -- and a
      // meadow of blades is made of nothing else. With one ray the offset is
      // nought and this is exactly the fragment phase one drew.
      vec2 off = vec2(0.0);
      if (rays == 2) off = (k == 0) ? vec2(-0.25, -0.125) : vec2(0.25, 0.125);
      else if (rays == 3) off = (k == 0) ? vec2(-0.30, -0.15)
        : (k == 1) ? vec2(0.0, 0.30) : vec2(0.30, -0.15);
      else if (rays == 4) off = (k == 0) ? vec2(-0.375, -0.125)
        : (k == 1) ? vec2(-0.125, 0.375)
        : (k == 2) ? vec2(0.125, -0.375) : vec2(0.375, 0.125);
      vec3 dir = normalize(dir0 + ddx * off.x + ddy * off.y);
      // No axis exactly nought, so that every reciprocal below is a number: a
      // ray straight down the y axis would otherwise never leave its own column.
      dir.x = abs(dir.x) < 1e-6 ? 1e-6 : dir.x;
      dir.z = abs(dir.z) < 1e-6 ? 1e-6 : dir.z;
      dir.y = abs(dir.y) < 1e-6 ? 1e-6 : dir.y;
      vec3 inv = 1.0 / dir;

      // WHERE THE RAY ENTERS THE WINDOW. The box draws its BACK faces so that
      // the walker may stand inside it -- which they always do -- and a front
      // face would then be culled and the ground would vanish from under their
      // feet. So the entry is solved and not interpolated.
      vec3 lo = vec3(uFarBounds.x, uHeight.x, uFarBounds.y);
      vec3 hi = vec3(uFarBounds.z, uHeight.y, uFarBounds.w);
      vec3 a = (lo - eye) * inv;
      vec3 b = (hi - eye) * inv;
      vec3 nearT = min(a, b);
      vec3 farT = max(a, b);
      float tEnter = max(max(nearT.x, nearT.y), max(nearT.z, 0.0));
      float tLeave = min(farT.x, min(farT.y, farT.z));

      used++;
      if (tLeave <= tEnter) continue;

      Hit hit = march(eye, dir, inv, tEnter, tLeave, dither);
      vec4 c = shade(dir, hit);
      sum += c;
      if (c.a > 0.0 && hit.t < nearest) nearest = hit.t;
      // AND THE FIRST RAY DECIDES WHETHER THERE ARE ANY MORE.
      if (k == 0 && (!hit.found || hit.t > uRayNear)) rays = 1;
    }

    if (uDebug > 0.5 && uDebug < 1.5) {
      fragColour = vec4(vec3(float(gSteps) / float(uSteps)), 1.0);
      return;
    }
    if (sum.a <= 0.0) {
      if (uDebug > 1.5) { fragColour = vec4(1.0, 0.0, 1.0, 1.0); return; }
      discard;
    }
    // THE COLOUR IS THE MEAN OF THE RAYS THAT FOUND GROUND AND THE ALPHA IS THE
    // SHARE OF THEM THAT DID, which is the whole of what more than one ray
    // buys: a pixel on the silhouette of the ridge carries the fraction of
    // itself the ridge covers, and what is behind it is the sky that was drawn
    // before this pass. With one ray the alpha is one and nothing is blended.
    fragColour = vec4(sum.rgb / sum.a, sum.a / float(max(used, 1)));

#ifdef CAMPO_DEPTH
    // THE DEPTH, so everything else in the world cuts into the blades per pixel:
    // a flower's stem, the walker's own feet, the foot of a monolith. It costs
    // this draw its early depth test, which is why it is a define -- a program
    // that writes gl_FragDepth at all has lost the early test whatever a branch
    // decides, so a cost that could not be compiled away could not be measured.
    //
    // THE NEAREST OF THE RAYS AND NOT THEIR MEAN: a depth is a place and not a
    // quantity, and the mean of two places on either side of a silhouette is a
    // point in the air between them.
    vec4 clip = uViewProjection * vec4(eye + dir0 * nearest, 1.0);
    gl_FragDepth = (clip.z / clip.w) * 0.5 + 0.5;
#endif
  }
`;

/**
 * The field's material: one program, two windows, three families, every literal
 * read from the seat that measured it.
 *
 * @param {object} options
 * @param {object} options.texture  the near clipmap's own texture
 * @param {object} options.far      the far clipmap's own texture
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
 * @param {number} options.rays     sub-pixel samples a fragment marches.
 */
export function campoMaterial({
  texture, far = null, sheets = null, depth = true, rays = 1,
} = {}) {
  const blade = bladeSettings();
  const earth = earthSettings();
  const ground = voxelSettings();
  const sheet = sheets ?? sheetArray(null);
  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    defines: depth ? { CAMPO_DEPTH: '1' } : {},
    uniforms: {
      tField: { value: texture },
      tFar: { value: far ?? texture },
      uLevelOrigin: { value: CAMPO.atlas.origins.map((o) => new Vector2(o.x, o.y)) },
      uFarOrigin: { value: CAMPO_FAR.atlas.origins.map((o) => new Vector2(o.x, o.y)) },
      uBounds: { value: new Vector4(0, 0, 0, 0) },
      uFarBounds: { value: new Vector4(0, 0, 0, 0) },
      uHeight: { value: new Vector2(-0.05, 1.6) },
      uCell: { value: CAMPO.cell },
      uGroundUnit: { value: CAMPO.unitGround },
      uBladeUnit: { value: CAMPO.unitBlade },
      uBias: { value: CAMPO_BIAS },
      uBladeCeil: { value: CAMPO_BLADE_CEIL },
      uSteps: { value: 96 },
      /**
       * The level the traversal starts at, IN NEAR CELLS.
       *
       * NINE, WHICH IS THE TOP OF THE FAR PYRAMID AND NOT OF THE NEAR ONE. A
       * near level of nine is a cell of 25.6 m, which is exactly level six of
       * the far picture -- the coarsest thing either window holds -- and it is
       * what a ray crossing four hundred metres of boundary has to be allowed
       * to skip in. Started at six (a cell of 3.2 m) the same ray would need a
       * hundred and twenty five steps to cross the window and would run out:
       * measured, the frame went from 12 ms to 33.
       */
      uTopLevel: { value: 9 },
      /**
       * The level a ray STARTS at, which is not the level it may reach.
       *
       * FOUR, which is phase one's own top: a cell of 80 cm, and the first
       * thing a ray meets near the eye is nearly always inside one. From there
       * it climbs one level per empty cell, so it is at the top of the far
       * pyramid after twenty five metres of air and pays no descent it does not
       * use. See the note in march() for the eight milliseconds this is worth.
       */
      uStartLevel: { value: 4 },
      /**
       * How many pixels a cell has to cover before the ray may stop at it.
       *
       * TWENTY FOUR, AND IT IS THE ONE NUMBER THE SCINTILLATION WAS WON ON.
       *
       * Phase one's ladder -- the finest cells inside eight metres, the next
       * inside sixteen (D-P3) -- is a footprint rule with the footprint left
       * implicit: at the high tier's own pixel a five centimetre cell at eight
       * metres covers 6.7 of them. Written as the footprint it is one number
       * instead of two and it follows the viewport and the field of view
       * instead of standing still while they move.
       *
       * AND THEN IT WAS SWEPT, because it is the dial the scintillation is
       * fought on: geometry finer than this is not drawn at all rather than
       * sampled once a pixel. Measured on the walk, as the mean change of a
       * pixel between two consecutive frames, against the CUBES the committente
       * has already accepted (levels of 255, four windows of the frame):
       *
       *     cubi        12.16  12.37  11.33  6.84
       *     gain  6.5   17.89  18.11  14.57  7.78     worse everywhere
       *     gain 12     15.17  14.99  10.63  5.88
       *     gain 18     13.22  11.28  10.22  5.24
       *     gain 24     10.88  11.07   8.27  5.07     under the cubes everywhere
       *     gain 32      9.00   6.71   4.56  3.96     and the meadow goes flat
       *
       * Twenty four is the coarsest the meadow can be drawn at while still
       * reading as blades in the near field, and the finest at which nothing
       * scintillates more than the cubes did. What it costs is that the narrow
       * blade of E-DECISIONI10 G3 is only resolved inside 2.2 m; that is
       * declared in the verbale and it is a dial the committente may move.
       */
      uLodGain: { value: 24 },
      /**
       * How wide the band is where one level of detail gives way to the next,
       * in levels, spread by the pixel's own hash.
       *
       * NOUGHT, AND IT IS A CHANGE OF MIND WITH A PICTURE BEHIND IT. Phase two
       * started at ONE -- a whole octave, which is the textbook stochastic mip
       * -- and it is right for a photograph and wrong for a voxel: two
       * neighbouring pixels were drawing cells of twenty and of forty
       * centimetres, so a meadow read as a MUSH of two block sizes instead of
       * as blocks. Measured, the octave also cost half again as much energy at
       * the frequency of the pixel (laplacian 33.7 against 23.4 in the near
       * window). At nought the levels meet on a ring -- and the ring is not
       * found, because what changes across it is the size of a cube in a world
       * made of cubes, which is a thing this world does everywhere anyway.
       */
      uDither: { value: 0 },
      uRays: { value: rays },
      /**
       * How far a hit may be and still be worth a second ray, in metres.
       *
       * TEN, and it is where the level of detail has merged the blades into
       * cells a pixel cannot see inside of anyway: past it a second sample
       * lands on the same cell as the first and buys nothing, while costing the
       * longest marches in the frame. Nought is one ray everywhere.
       */
      uRayNear: { value: 10 },
      uHorizon: { value: 1 },
      uSunMarch: { value: SUN_MARCH },
      uDebug: { value: 0 },
      uPixelScale: { value: 0.002 },
      uSkySlope: { value: 10 },
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
      uEarthMinStep: { value: EARTH.minStep },
      uEarthToEye: { value: EARTH.toEye ? 1 : 0 },
      ...faceLightUniforms(TERRAIN.lightScale * GROUND_EXPOSURE),
      ...SCENE_LIGHT_UNIFORMS,
      ...fogUniforms(),
      ...campoCutUniform(),
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    // BACK FACES, so the box still draws when the walker is inside it: the eye
    // stands 1.6 m up and the box is the whole world.
    side: BackSide,
    fog: false,
    depthWrite: true,
    depthTest: true,
    // AND IT STAYS IN THE OPAQUE PASS. `transparent` false keeps it there, in
    // renderOrder, after everything else that writes depth and after the sky:
    // so the only thing a partly covered pixel can blend against is what is
    // already behind it, which is exactly what a coverage is supposed to
    // reveal. At one ray every alpha is one and the blend is a copy.
    transparent: false,
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
 * A unit of the world scaled by its model matrix, and it is the FAR window's
 * own extent now: four hundred metres of ground, one draw, four hundred bytes
 * of geometry. Where it stands is a matrix, so it costs no upload at all.
 */
export function campoBox(material, onRenderer = null) {
  const side = CAMPO_FAR.side * CAMPO_FAR.cell;
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
  // test instead of shading them -- and it is also what lets a partly covered
  // pixel blend against a sky and a skyline that are already there.
  mesh.renderOrder = 10;
  return mesh;
}
