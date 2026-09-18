import {
  BackSide, BoxGeometry, CustomBlending, DataTexture, DoubleSide, GLSL3, LinearFilter, Matrix4,
  Mesh, OneMinusSrcAlphaFactor, PlaneGeometry, RedFormat, ShaderMaterial, SrcAlphaFactor, Vector2,
  Vector3, Vector4,
} from 'three';
import { CAMPO_JITTER, CAMPO_LAYER } from '../../core/post.js';
import { SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS } from '../../core/sky.js';
import { FACE_LIGHT_GLSL, faceLightUniforms } from '../face-light.js';
import { FOG_GLSL, GROUND_EXPOSURE, fogUniforms } from '../air.js';
import TERRAIN from '../../../assets-src/terrain/terrain.json' with { type: 'json' };
import { EARTH, MANTO, SUN_STEPS } from './worldgen.js';
import { ALBEDO, PIGMENT_GLSL, pigmentUniforms, refreshPigment } from './pigment.js';
import { SHEET_GLSL, sheetArray, sheetUniforms } from './sheet.js';
import { bladeSettings, earthSettings, voxelSettings } from './material.js';
import {
  CAMPO, CAMPO_BEARINGS, CAMPO_BIAS, CAMPO_BLADE_CEIL, CAMPO_CUT_GLSL, CAMPO_FAR,
  CAMPO_FAR_SHIFT, CAMPO_LOOK_MAX, CAMPO_LOOK_SHIFT, CAMPO_MATERIAL, CAMPO_RUNG,
  campoCutUniform, zoneFrame,
} from './campo.js';

/**
 * THE WELL'S OWN LADDER, AND IT IS A SECOND MEASUREMENT AND NOT A SECOND COPY.
 *
 * bladeSettings().base is E-ERBA-A 1.6's own reading -- the fall at the foot of
 * ONE blade, 16% at nought and home by seven centimetres -- and R1 S2 is
 * explicit that it stays that: <<la caduta alla base di E-ERBA-A 1.6 resta per
 * la faccia di un filo isolato; il POZZO e' la stessa scala con base (0,85,
 * 0,50)>>. They are two quantities. One is how much sky a blade's own foot
 * loses to the blade above it; the other is how much sky THE GROUND BETWEEN THE
 * BLADES loses to the mat standing on it, which is most of a hemisphere.
 *
 * SO IT LIVES HERE AND NOT IN bladeSettings(), and that is what keeps one light
 * in this world rather than two. The greedy mat (./material.js) draws blades and
 * draws the ground under them through a DIFFERENT material; it has no well and
 * never had one, so a pair for the well cannot disagree with it. Blades are left
 * reading the one pair both paths share, so a blade the field draws and a blade
 * the mesher draws are still lit by the same arithmetic -- which is the property
 * ../face-light.js exists to hold and the one a second copy would break.
 *
 * FITTED HERE, ON THIS TIP, AND NOT CARRIED ACROSS. Swept live at the fitted
 * pose over x in 0.40-0.85 and y in 0.50-0.62, judged on the level ratio of the
 * three families in R1's pp-dx window -- dark over light, which is scale free
 * and so is the one reading of this window the zones do not contaminate:
 *
 *     spedito (nessun pozzo sul suolo)   0.266      x 0.70, y 0.50   0.249
 *     x 0.40, y 0.50                     0.259      x 0.85, y 0.62   0.249
 *     x 0.55, y 0.50                     0.254      x 0.85, y 0.50   0.244
 *
 * against the target's 0.240. It is R1's own pair, and it arrives at the target
 * from a sweep that did not know the answer.
 */
export const CAMPO_WELL = [0.85, 0.50];

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
// 2. THE LEVEL OF DETAIL IS A DISTANCE IN METRES FROM THE WALKER. Inside
//    uLodNear the mat is drawn whole, at five centimetres; after it the cell
//    grows by uLodStep at each front. Nothing in that rule knows the field of
//    view, the viewport or where the eye is looking, which is what stops the
//    meadow from redrawing itself when the walker zooms or turns; and what a
//    coarse cell then loses is given back not as geometry but as the
//    STATISTIC of the mat it covered, so a plate is lit like the blades and
//    wells it stands for. See march() for the ladder and shade() for the look.
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

// ---------------------------------------------------------------------------
// THE LIGHT BY PLACE: ONE PICTURE, ONE ARITHMETIC, AND EVERY MATERIAL THAT
// STANDS ON THIS GROUND READS THE SAME ONE.
//
// The map is tools/zone/paint-zone.mjs's -- the law of the world's own seats
// times the residual measured off the reference -- and it is delivered as
// `zone-shade`. What lives here is the SEAT: the one line of GLSL that turns a
// point on the ground into the factor its light is multiplied by, and the one
// place the delivered texture is bound.
//
// WHY IT IS A SEAT AND NOT A TERM IN THIS FILE. The field draws the meadow and
// the ground it stands on; the flowers and the sprays of ../vegetation.js stand
// IN that meadow and are drawn by three other programs. A zone that dimmed the
// grass and left the flowers at full sun would be two different weathers over
// one square metre -- which is exactly what the first cut of this looked like,
// with white heads at open-meadow brightness standing inside a band the ground
// had gone dark in. One picture, one function, one uniform, four programs.
//
// IN XZ AND NOT ALONG THE SURFACE, because a zone is a fact about the GROUND
// and not about a face: the flank of a blade, the top of the column it stands
// on, the earth of the wall beside it and the head of a flower over it are all
// standing in the same weather and have to be dimmed by the same number, or the
// zone reads as a pattern on the geometry instead of as light lying over it.
//
// AND OUTSIDE THE SQUARE IT IS ONE. The sampler clamps to its own edge and the
// painter refuses a map whose rim is not open meadow, so a point four hundred
// metres out on the boundary reads exactly the value this term is neutral at.
// There is no branch here, and a branch is what asking would cost.

/**
 * @param {string} fetch  how this program's dialect reads a sampler. The field
 *                        is GLSL3 and reads `texture`; the three programs of
 *                        the vegetation are ESSL1 and read it from a VERTEX
 *                        shader, where the level has to be named. One
 *                        arithmetic, two spellings, and neither is a copy.
 */
export const zoneGlsl = (fetch = 'texture(tZone, uv)') => /* glsl */`
  uniform sampler2D tZone;
  uniform vec3 uZone;
  float zoneAt(vec2 xz) {
    vec2 uv = (xz - uZone.xy) * uZone.z;
    return ${fetch}.r;
  }
`;

/**
 * ONE WHITE TEXEL, for the frames drawn before the map has landed.
 *
 * A program built with no zone has to draw the world that shipped before the
 * zone existed, which is a factor of one everywhere -- not a black meadow, and
 * not a branch in the fragment either.
 */
const ZONE_NEUTRAL = (() => {
  const texture = new DataTexture(new Uint8Array([255]), 1, 1, RedFormat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
})();

let zoneMap = ZONE_NEUTRAL;
/** Every uniform waiting on the delivery, so the order of the layers cannot matter. */
const zoneBound = [];

/** The pair a program reads the zone through. Bound by reference, not copied. */
export function zoneUniforms() {
  const tZone = { value: zoneMap };
  zoneBound.push(tZone);
  return { tZone, uZone: { value: new Vector3(...zoneFrame()) } };
}

/**
 * THE DELIVERY LANDS ONCE, HERE, AND REACHES EVERY PROGRAM THAT ASKED.
 *
 * Called by the layer that owns the ground the moment the fetch returns. It is
 * a seat and not an argument threaded through four constructors because the
 * vegetation is built by a different layer, in an order this file may not
 * assume: a program that asked before the delivery is updated, and one that
 * asks after it is handed what is already there.
 */
export function setZoneMap(texture) {
  if (!texture) return;
  zoneMap = texture;
  for (const u of zoneBound) u.value = texture;
}

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

/**
 * THE FOUR TAPS, THEIR GATE AND THE RIM: ONE TEXT, READ BY TWO PROGRAMS.
 *
 * The recomposition is compiled twice on purpose -- once as the small program
 * that only ever weighs texels (RESOLVE_FRAGMENT, at the foot of this file)
 * and once as a door into the field's OWN program, which can also march (the
 * CAMPO_RESOLVE half of FRAGMENT below) -- and the one thing that must not
 * follow from that is two opinions about which texel a pixel belongs to. So
 * the uniforms, the taps, the gate and the rim are spliced into both from
 * HERE, character for character; what the marching one adds it adds BETWEEN
 * them and nowhere else, and what it may not do is move the picture the
 * handle is off in.
 */
const RESOLVE_UNIFORMS = /* glsl */`
  uniform sampler2D tCampo;
  uniform sampler2D tCampoDepth;
  uniform vec2 uCampoSize;
  uniform float uCampoOn;
  uniform vec2 uFrameSize;
  uniform float uEdge;
  uniform float uEdgeFloor;
  uniform float uCoverage;
`;

/** From the four taps to rgb, depth, mass, cover and dropped. */
const RESOLVE_CORE = /* glsl */`
    // The null, and it is a whole pixel of nothing: with no field buffer bound
    // there is no ground to put back, and the field's own mesh is drawn in the
    // world's pass instead. See CAMPO_LAYER in src/core/post.js.
    if (uCampoOn < 0.5) discard;

    // Where this pixel's CENTRE falls in the reduced buffer, in texel units
    // with the half texel taken off, so «base» is the lower left of the four
    // that surround it -- the footing a bilinear tap stands on.
    vec2 t = (gl_FragCoord.xy / uFrameSize) * uCampoSize - 0.5;
    vec2 base = floor(t);
    vec2 f = t - base;
    ivec2 lim = ivec2(uCampoSize) - 1;
    ivec2 b = ivec2(base);

    ivec2 at[4];
    at[0] = clamp(b,               ivec2(0), lim);
    at[1] = clamp(b + ivec2(1, 0), ivec2(0), lim);
    at[2] = clamp(b + ivec2(0, 1), ivec2(0), lim);
    at[3] = clamp(b + ivec2(1, 1), ivec2(0), lim);

    vec4 c[4];
    float d[4];
    float w[4];
    w[0] = (1.0 - f.x) * (1.0 - f.y);
    w[1] = f.x * (1.0 - f.y);
    w[2] = (1.0 - f.x) * f.y;
    w[3] = f.x * f.y;
    for (int i = 0; i < 4; i++) {
      c[i] = texelFetch(tCampo, at[i], 0);
      d[i] = texelFetch(tCampoDepth, at[i], 0).x;
    }

    // I MODI DI DIAGNOSI, prima di ogni cancello: quello che il quadro LEGGE,
    // separato da quello che ne fa. 3 il colore del texel, 4 la sua copertura,
    // 5 la sua profondita', 6 il quadro intero in magenta.
    //
    // E SOPRA IL 6 IL TEXEL PASSA COM'E'. I modi del CAMPO stanno sull'altra
    // sponda della stessa cucitura -- uDebug e' un solo seggio, condiviso per
    // riferimento (campoResolve(seat)) -- e il 7 di U-SUOLO-3 dipinge di verde
    // le traversate CHIUSE. Una ricomposizione che ci mettesse sopra il proprio
    // magenta cancellerebbe la ricevuta prima che qualcuno la conti; e la
    // profondita' resta quella vera, perche' il selciato del corridoio va
    // ancora composto con la terra e non davanti a essa.
    if (uDebug > 2.5) {
      int r0 = (f.x >= 0.5 ? 1 : 0) + (f.y >= 0.5 ? 2 : 0);
      vec3 show = uDebug < 3.5 ? c[r0].rgb
        : uDebug < 4.5 ? vec3(c[r0].a)
        : uDebug < 5.5 ? vec3(pow(d[r0], 64.0))
        : uDebug < 6.5 ? (c[r0].a > 0.0 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 1.0))
        : c[r0].rgb;
      fragColour = vec4(show, 1.0);
      gl_FragDepth = (uDebug > 5.5 && uDebug < 6.5) ? 0.0 : d[r0];
      return;
    }

    // THE TAP THIS PIXEL IS ACTUALLY IN, which is the one the gate clusters
    // around. Not the nearest of the four and not the mean of them: a pixel
    // belongs to one texel of the reduced buffer, and at an edge the honest
    // answer is the side of the edge it is on.
    int ref = (f.x >= 0.5 ? 1 : 0) + (f.y >= 0.5 ? 2 : 0);
    if (c[ref].a <= 0.0) {
      // It fell on sky. Then this pixel is on the rim, and what it clusters
      // around is the heaviest neighbour that DID find ground -- so the colour
      // comes from the ridge and the coverage from how much of the pixel the
      // ridge holds.
      float best = -1.0;
      for (int i = 0; i < 4; i++) {
        if (c[i].a > 0.0 && w[i] > best) { best = w[i]; ref = i; }
      }
      if (best < 0.0) discard;
    }
    float dr = d[ref];

    float gx = min(abs(d[1] - d[0]), abs(d[3] - d[2]));
    float gy = min(abs(d[2] - d[0]), abs(d[3] - d[1]));
    float tol = uEdge * (gx + gy) + uEdgeFloor;

    vec3 rgb = vec3(0.0);
    float depth = 0.0;
    float mass = 0.0;
    // The whole neighbourhood's coverage, gate or no gate: what is being asked
    // here is how much of this pixel is ground at all, and a tap dropped for
    // standing on the far side of an arris is still ground.
    float cover = 0.0;
    float dropped = 0.0;
    for (int i = 0; i < 4; i++) {
      float a = c[i].a;
      cover += w[i] * a;
      float keep = (a > 0.0 && abs(d[i] - dr) <= tol) ? 1.0 : 0.0;
      dropped += (a > 0.0 ? 1.0 : 0.0) * (1.0 - keep);
      float m = w[i] * a * keep;
      rgb += c[i].rgb * m;
      depth += d[i] * m;
      mass += m;
    }
    if (mass <= 0.0) discard;
    rgb /= mass;
    depth /= mass;`;

/** And from those to the rim, the diagnosis and the pixel. */
const RESOLVE_TAIL = /* glsl */`

    // NOUGHT IS THE RIM THAT SHIPPED and one is the rim the coverage pays for.
    // The binary arm rounds at a half rather than at anything above nothing,
    // because a rim that turned on at the first lit texel would grow the meadow
    // by a texel into the sky -- which is the one thing a recomposition is not
    // allowed to do, and the name for it is a halo.
    float alpha = mix(step(0.5, cover), clamp(cover, 0.0, 1.0), uCoverage);
    if (alpha <= 0.0) discard;

    if (uDebug > 0.5) {
      // 1: where the gate did work, which is where the field's own depth breaks
      //    -- the arrises, the rim, the lip of a terrace.
      // 2: the coverage itself, which is where the ridge meets the sky.
      vec3 mark = uDebug > 1.5 ? vec3(alpha) : mix(rgb, vec3(1.0, 0.1, 0.0), min(1.0, dropped));
      fragColour = vec4(mark, alpha);
      gl_FragDepth = depth;
      return;
    }

    fragColour = vec4(rgb, alpha);
    gl_FragDepth = depth;`;

const FRAGMENT = /* glsl */`
  precision highp float;
  precision highp int;

#ifndef CAMPO_RESOLVE
  // THE POINT ON THE BOX THIS FRAGMENT STANDS ON, which is how the marcher
  // aims its ray. The recomposition has no box: its quad is handed over in
  // clip space and it unprojects instead. See the CAMPO_RESOLVE half below.
  in vec3 vWorld;
#endif
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
  // THE LEVEL OF DETAIL, IN METRES FROM THE WALKER. uLodNear is the radius of
  // the ring the mat is drawn whole inside, uLodStep the factor between one
  // front and the next, uLodCentre the point on the plane they are measured
  // from -- which is the WALKER and not the eye, and is held back by
  // uLodSnap metres of hysteresis so that a step taken and taken back changes
  // no cell at all. See march().
  uniform float uLodNear;
  uniform float uLodStep;
  uniform vec2 uLodCentre;
  // ------------------------------------------------- AND THE BAND (U-CAMPO-2)
  //
  // The centre is TWO points now: uLodCentre is where the walker stood uLodLag
  // milliseconds ago, uLodCentre2 is where they stand this frame, and every
  // pixel reads a point of the segment between them chosen by its OWN hash. A
  // front is then a band as wide as the walker covers in that lag -- 30 cm at a
  // metre a second -- inside which cells change size ONE AT A TIME, in the order
  // of the hash, as the walker advances. Not a line that jumps: a grain that
  // moves. Standing still, after the lag, the two points are one and the frame
  // is what it always was, to the byte.
  //
  // uLodMix nought is the OTHER shape of the same handle, kept because it is
  // what R2's S3 proposed and what the bench weighs the band against: the centre
  // still jumps, and uLodFade is how far a screen-door dissolve between the old
  // point and the new one has got.
  uniform vec2 uLodCentre2;
  uniform float uLodFade;
  uniform float uLodMix;
  // WHETHER THE GRAIN IS ATTACHED TO THE MEADOW OR TO THE GLASS. On the glass
  // (nought) the hash is the pixel's own address, which is the cheapest thing
  // there is and is what R2's dissolve used; walking, it crawls, because the
  // ground moves under a speckle that does not. On the meadow (one) the hash is
  // the five centimetre cell of the plateau this pixel's ray lands on, so a
  // patch of grass keeps its own place in the order for as long as it is in
  // frame and the band reads as ground rather than as film grain.
  uniform float uLodWorld;
  uniform float uDither;
  // How hard the statistic of the mat pulls a coarse cell towards the light of
  // the mat it stands for, and how deep under its own canopy that mat sits.
  // See campoReduce in ./campo.js and the foot of shade().
  uniform float uLookGain;
  uniform float uLookRung;
  uniform int uRays;
  uniform float uRayNear;
  uniform float uHorizon;
  uniform vec3 uSunMarch[${SUN_MARCH.length}];
  uniform float uDebug;
  // How much ground one screen pixel covers at one metre, head on. See the note
  // over the footprint in shade() for why it is a uniform and not an fwidth.
  uniform float uPixelScale;
  uniform float uSkySlope;
  // THE HORIZON'S RING, four bearings to a vector. See campoHorizon in
  // ./campo.js for what it holds and why it may be trusted with a discard.
  // (uHorizon above is the SUN's march and has nothing to do with it.)
  uniform vec4 uSkyRing[${CAMPO_BEARINGS / 4}];
  uniform mat4 uViewProjection;
  // THE SUB-TEXEL OFFSET OF THE WHOLE PIXEL'S WORTH OF RAYS, in texels of the
  // buffer this program is drawing into, and NOUGHT is the world that ships.
  //
  // It is a second hand on the same dial the rotated grid of «off» below turns:
  // where that one spreads several rays inside ONE frame, this one moves the
  // whole pattern between frames, so that a ground sampled once a texel is
  // sampled in a different place each time and the frames may be added up. It
  // is written by src/core/post.js (CAMPO_JITTER), shared by reference, and it
  // is nought on every frame the memory is not accumulating -- which is what
  // makes the null exact: adding a nought to the offset leaves the same float.
  uniform vec2 uJitter;

  // The families' own numbers, read out of the settings objects of
  // ./material.js and never written again here.
  uniform vec2 uWell;
  uniform vec3 uAlbedoSoil;
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


  ${zoneGlsl()}
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
  // Where the blade stops and the statistic starts in the first byte, as the
  // wrap and the full scale the fragment divides by. See campoReduce.
  const float BLADE_WRAP = ${(1 << CAMPO_LOOK_SHIFT).toFixed(1)};
  const float LOOK_MAX = ${CAMPO_LOOK_MAX.toFixed(1)};

  // ---------------------------------------------------------------- the pair
  // What a texel says about height, in the two units it holds it in: the ground
  // in whole voxels off a biased byte, the blade in quarter-blades over it. See
  // the head of ./campo.js for why the two are not one unit any more.
  // AND THE FIRST BYTE CARRIES TWO NUMBERS. The low five bits are the blade --
  // five rungs of MANTO.law at SUB steps each is twenty, which is what five
  // bits hold -- and the high three are the mat's own statistic, written by
  // campoReduce for every level over the finest. Every reader of the height
  // takes the mask first; the statistic is read only by the light.
  float bladeSubOf(vec4 t) { return mod(floor(t.r * 255.0 + 0.5), BLADE_WRAP); }
  float lookOf(vec4 t) { return floor((t.r * 255.0 + 0.5) / BLADE_WRAP) / LOOK_MAX; }
  float groundYOf(vec4 t) { return (t.g * 255.0 - uBias) * uGroundUnit; }
  float topYOf(vec4 t) { return groundYOf(t) + bladeSubOf(t) * uBladeUnit; }
  // And the same top in the SUB-steps the sun's own march counts in.
  float topSubOf(vec4 t) { return (t.g * 255.0 - uBias) * RUNG + bladeSubOf(t); }
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
    // WHETHER THIS GROUND WAS FOUND OR CLOSED. A ray that runs out of steps is
    // answered with the ground it was standing over rather than with the sky:
    // see THE TRAVERSAL THAT RAN OUT at the foot of march(). This is the
    // receipt that says which of the two happened, and uDebug 7 paints it.
    bool closed;
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
    hit.closed = false;
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

    // THE FLOOR OF THE DETAIL, IN METRES FROM THE WALKER, AS A LADDER.
    //
    // ------------------------------------------------------------------------
    // WHAT CHANGED AND WHY, IN THE COMMITTENTE'S OWN WORDS. «Vedo generare il
    // prato a piu' punti quando cammino o ZOOMMO, da' molto fastidio
    // all'occhio.» The floor used to be a FOOTPRINT: the finest cell a ray
    // could stop at was the one covering about a gain of pixels (uLodGain,
    // which this file no longer has), so it stood where
    // travelled * uPixelScale * uLodGain / uCell crossed a power of
    // two. Two things follow from that and both are the defect.
    //
    //   IT MOVES WITH THE FIELD OF VIEW. uPixelScale is 2 tan(fov/2) / height,
    //   so zooming from 44.2 to 25 degrees pushes every front out by 1.83x:
    //   measured (R2 §1.2), the same meadow from the same spot redraws itself
    //   at another cell size, and 202 000 pixels of one level become 99 000. A
    //   photograph enlarged does not redraw its grass; this did.
    //
    //   IT MOVES WITH THE EYE AND NOT WITH THE WALKER. travelled is distance
    //   from the CAMERA, so a head that turns -- or a camera that leans off the
    //   walker -- drags the fronts round with it.
    //
    // So the floor is now a DISTANCE IN METRES FROM THE WALKER, on the plane:
    // level 0 inside uLodNear, and one rung every factor uLodStep after it.
    // The fronts are the tier's own numbers (quality.js groundDetail), the fov
    // is not in them anywhere, and zooming enlarges the cells that are there.
    //
    // AND THE STEP CHANGES AT THE FAR WINDOW'S OWN LEVEL, which is not a magic
    // number. Below FAR_SHIFT the rungs are the ring's -- a slow factor, so
    // the full detail reaches as far out as it can before the near window ends
    // (the constraint is uLodNear * uLodStep^2 <= 19.2 m: past that there is
    // only the forty centimetre texel and a law that held level 2 out there
    // would make a ring that JUMPS with the window, measured at 8.2% of the
    // ground in one step). At and above FAR_SHIFT the picture itself is forty
    // centimetres, so the rung doubles like the pyramid does and four levels
    // carry the ray over four hundred metres, which is what keeps the march
    // inside uSteps.
    //
    // ------------------------------------------------------------------------
    // IT IS STILL A LADDER AND NOT A LOGARITHM, and now it is a ladder in the
    // SQUARE of the distance so that no step pays a square root either. The
    // floor only ever climbs -- see the running maximum below -- so this is one
    // compare a step and one multiply per level, against a log2 and a sqrt at
    // every step of every ray.
    //
    // AND THE DISTANCE IS A RUNNING MAXIMUM, WHICH IS WHAT KEEPS IT A LADDER.
    // Distance from the EYE grows along a ray by construction; distance from
    // the WALKER does not, because the centre is held back by the hysteresis
    // below and a ray may close on it before it recedes. The dip is at most
    // uLodSnap metres and it is inside the ring, where the floor is nought
    // anyway; taking the farthest the ray has been keeps the invariant the
    // whole traversal is written on -- a level is never given back -- for the
    // price of one max.
    //
    // THE DITHER STILL SPREADS THE FRONT, IN THE LADDER'S OWN OCTAVE. At
    // uDither nought (what ships: E-PERF-3 measured an octave as «una poltiglia
    // di due misure di blocco») this is exactly one and costs a compare.
    float jitter = uDither > 0.0 ? pow(uLodStep, uDither * (dither - 0.5)) : 1.0;
    float lodRung = uLodNear * jitter;
    float lodRung2 = lodRung * lodRung;
    float step2 = uLodStep * uLodStep;
    int lodFloor = 0;
    // How far from the WALKER, squared, the ray has been at its farthest.
    float far2 = 0.0;
    // The ray's own parameter, kept because tEnter and tLeave are measured in
    // it and the crossings are added to it.
    float tRay = tEnter + 1e-4;
    // WHETHER THE RAY LEFT THE WORLD OR SIMPLY STOPPED IN IT. The loop below
    // ends three ways and they are not the same answer: a ray that walked out
    // of the far window, or past the end of its own interval, has looked at
    // every cell there was and found nothing -- that is SKY, and it is the
    // right answer. A ray that hit the ceiling on its steps has not looked at
    // anything of the sort: it is still inside the world, still under the
    // canopy it was crossing, and the ground it was over is still there. See
    // THE TRAVERSAL THAT RAN OUT, under the loop.
    bool escaped = false;

    // ---------------------------------------------- WHICH CENTRE THIS PIXEL HAS
    //
    // Once, before the loop, because it must be ONE number for the whole ray:
    // far2 below is a running maximum and the invariant the traversal is written
    // on -- a level is never given back -- holds only while the point it is
    // measured from stands still along the ray.
    //
    // The anchor for the world-side hash is where the ray meets the plateau's
    // own level, which is a place on the GROUND and therefore does not move when
    // the camera does. A ray with no downward slope never reaches it and never
    // reads ground either, so it falls back on the eye and costs nothing.
    float toFoot = dir.y < -1e-3 ? -eye.y / dir.y : -1.0;
    vec2 grain = toFoot > 0.0 ? eye.xz + dir.xz * toFoot : eye.xz;
    float lodSel = uLodWorld > 0.5
      ? pigHash(floor(grain.x / uCell), floor(grain.y / uCell))
      : pigHash(gl_FragCoord.x + 7.0, gl_FragCoord.y + 3.0);
    vec2 lodC = uLodMix > 0.5
      ? mix(uLodCentre, uLodCentre2, lodSel * uLodFade)
      : (lodSel < uLodFade ? uLodCentre2 : uLodCentre);

    for (int i = 0; i < 512; i++) {
      if (i >= uSteps) break;
      gSteps = i;
      vec2 fromWalker = p.xz - lodC;
      far2 = max(far2, dot(fromWalker, fromWalker));
      // WHICH RUNG THE RAY HAS REACHED. It only ever climbs, so this is one
      // compare a step and one multiply a level, and never a level twice.
      for (int k = 0; k < ${CAMPO.levels + CAMPO_FAR.levels}; k++) {
        if (far2 < lodRung2 || lodFloor >= uTopLevel) break;
        lodFloor++;
        lodRung2 *= lodFloor < FAR_SHIFT ? step2 : 4.0;
      }
      // AND THE LADDER IS NOT THE FLOOR ITSELF. The far window raises the floor
      // for the step it is answering (below), and that raise belongs to the
      // step and not to the ray: a ray that crosses the boundary and comes back
      // inside the near window has to be allowed its own detail again. So the
      // ladder is what the DISTANCE has earned, and the floor is a copy of it
      // that this one step may push up.
      int floorLevel = lodFloor;
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
      tRay += tExit + 1e-4;
      // PAST THE FAR WALL OF THE WINDOW, and the comparison is against the
      // parameter along the ray and not against the length of the interval:
      // tLeave is measured from the EYE, so a window entered fourteen metres
      // out would otherwise be abandoned after the six metres it is deep.
      if (tRay > tLeave) { escaped = true; break; }
      if (p.x < uFarBounds.x || p.z < uFarBounds.y
        || p.x > uFarBounds.z || p.z > uFarBounds.w
        || p.y < uHeight.x || p.y > uHeight.y) { escaped = true; break; }
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

    // ======================================================================
    // THE TRAVERSAL THAT RAN OUT, AND WHY IT MAY NOT ANSWER "SKY".
    //
    // THE DEFECT THIS IS THE ANSWER TO (E-DECISIONI23, U-SUOLO-3). «Linee di
    // cuciture azzurre ancora visibili quando cammino.» Measured on this tip,
    // on the page as delivered, with only the two engines that draw ground in
    // the frame: at pitch -26 in open meadow the top rows of the picture carry
    // runs of SKY -- up to 966 pixels in one plate -- lying on ground between
    // 23 and 30 m out that the aerial says is solid. They are the GRAZING rays,
    // the flattest in the frame, and they stand in thin lines because a line of
    // the picture is a line of bearings and the cost of a march is a property
    // of the bearing.
    //
    // WHAT THEY WERE, PROVED ONE SOURCE AT A TIME AND NOT REASONED:
    //
    //   the horizon did NOT throw them away. uDebug 2 paints the fragments that
    //   MARCHED and found nothing; the two discards over main() leave the pixel
    //   alone. Over a hundred and twenty walking frames: 650 magenta, ZERO
    //   black. Nothing was refused before it was marched.
    //
    //   the recomposition did not lose them. At campores=1, the frame drawn
    //   whole with no reduced buffer at all, the same four poses read 4924
    //   pixels against 2712 -- MORE, because the resolve's own neighbourhood
    //   fills a single lost texel and the native frame has nothing to fill it
    //   with. It is not the gate; it is covering for this.
    //
    //   nor the second ray, nor the band, nor the ring. camporaggi=1 reads
    //   2686 against 2712; the band taken off (mode snap, lag nought) reads 655
    //   magenta against 650; walking backwards reads 806. None of them moves.
    //
    //   IT IS THE CEILING ON THE STEPS, and it is monotone in it. The same four
    //   poses, the same plates, uSteps alone moved: 96 -> 2712 px, 128 -> 202,
    //   192 -> 0, 400 -> 0. On a walk: 48 -> 163 549 px, 96 -> 9 535, 400 ->
    //   2 069. A grazing ray crosses the meadow a cell at a time for twenty
    //   five metres and there are not always ninety six cells' worth of ceiling
    //   under it.
    //
    // AND A CEILING IS NOT A THING A PICTURE MAY BE MADE OF. Raising it buys a
    // smaller chance and never zero: the number of cells a grazing ray crosses
    // has no bound that a uniform can be set to, so any uSteps at all leaves a
    // pose that shows the sky through the grass. What has a bound is the
    // ANSWER. A ray that stopped because it ran out of steps is still inside
    // the world -- it did not leave through uFarBounds and it did not pass
    // tLeave, or escaped would say so -- and the cell it is standing over has
    // ground in it. That ground is the honest answer to the pixel: not the sky,
    // which is a statement about a place the ray never reached.
    //
    // WHAT IT COSTS, AND IT IS NOTHING IN THE FRAME. Every ray that finds its
    // ground returns from inside the loop and never arrives here; every ray
    // that leaves the world sets escaped and takes the branch out. What is
    // left is the handful of fragments that ran out, which is where the defect
    // was. Measured with the field's own clock, arms swapped in one opening of
    // the page on a uniform: see the verbale.
    //
    // WHERE IT PUTS THE SURFACE. Straight down, on the top of the cell the ray
    // stands in, and not along the ray: the extrapolation of a nearly flat ray
    // onto a plane below it is tens of metres long and would paint a smear, and
    // a ray this shallow has its ground under its own foot to within the cell
    // it is already in. Under the blade where one stands, on the soil where
    // none does -- topYOf is the one and groundYOf the other, exactly as the
    // finest level of the loop reads them.
    //
    // WHICH PICTURE IT ASKS, AND IT IS THE FINEST THAT ANSWERS AT ALL.
    //
    // Not the level the ray stopped at, and that is the whole of the second
    // attempt at this cure. The first closed on the ray's OWN cell and left four
    // pixels standing out of a hundred and four plates, always in the corner of
    // the frame -- which is where the recomposition's four taps collapse onto
    // one and a lost texel has no neighbour to be filled from, so one ray
    // becomes one hole. A coarse cell carries ONE CHILD'S byte (campoReduce
    // writes data[o + 2] = data[bo + 2], the child with the highest ground),
    // family and all: a cell of 3.2 m or of 25.6 m that straddles the CORRIDOR
    // reduces to family PATH.
    //
    // AND A FAMILY THIS FIELD STANDS ASIDE ON IS NOT AN ANSWER TO A RAY THAT
    // WAS STILL FLYING. That is the third attempt and the one that holds. The
    // four survivors were rays travelling the length of the corridor half a
    // metre over it -- measured against the law: from the failing station the
    // ray is at (1.17; 27.9) at twenty metres, over PATH, 0.56 m up, and its
    // true ground is the meadow at 37.7 m, eight metres further on. shade()
    // returns nought alpha on PATH by the law it has kept since E-SENT4 --
    // rightly, because the greedy disc draws that stone -- but the greedy's
    // stone is not on this ray: the ray never came down to it. Closing there
    // paints the very sky the closure was called to close.
    //
    // So where the finest texel says NOTHING the closure climbs -- one level at
    // a time, out of the near pyramid into the far one, up to the top, 25.6 m of
    // ground a side, which says something about everywhere the box contains.
    //
    // AND WHERE IT SAYS «CORRIDOR» IT IS READ AS MEADOW, WHICH LOOKS LIKE A LIE
    // AND IS NOT. Climbing does not escape it: campoReduce ranks its children on
    // the GROUND byte, the paving's ground is the meadow's own soil, and the
    // blade that makes the meadow taller is in another byte -- so a tie is
    // broken by whichever child came first, and over a corridor forty metres
    // long every rung can come back PATH. What settles it is the DEPTH TEST,
    // which has already run: this field draws at renderOrder 10, after the
    // greedy, into a buffer that already holds the corridor's stone at the
    // corridor's own depth. Where the paving is really in front of this pixel
    // the closed fragment is killed by that test and the stone stays; where it
    // is not -- which is every one of these rays, because they were still flying
    // half a metre over the paving on their way to the meadow beyond it -- there
    // is nothing in the buffer at all, and a meadow is the honest answer where
    // the sky is a statement about a place the ray never reached.
    if (!escaped && !hit.found) {
      bool nr = insideNear(p.xz);
      int lv = nr ? 0 : FAR_SHIFT;
      float span = uCell * exp2(float(lv));
      ivec2 cell = ivec2(floor(p.xz / span));
      vec4 t = cellAt(cell, lv, nr);
      for (int k = 0; k < ${CAMPO.levels + CAMPO_FAR.levels}; k++) {
        if (t.b > 0.0 || lv >= FAR_TOP) break;
        lv = lv + 1;
        nr = insideNear(p.xz) && lv <= NEAR_TOP;
        if (!nr && lv < FAR_SHIFT) lv = FAR_SHIFT;
        span = uCell * exp2(float(lv));
        cell = ivec2(floor(p.xz / span));
        t = cellAt(cell, lv, nr);
      }
      // The family read as the meadow's, on the byte and nowhere else, so that
      // every other reader of this texel is untouched.
      int closedPacked = int(t.b * 255.0 + 0.5);
      if ((closedPacked & 3) == ${CAMPO_MATERIAL.PATH}) {
        t.b = float(closedPacked - ${CAMPO_MATERIAL.PATH} + ${CAMPO_MATERIAL.GRASS}) / 255.0;
      }
      if (!campoYields(p.xz) && t.b > 0.0) {
        float groundY = groundYOf(t);
        float topY = topYOf(t);
        hit.found = true;
        hit.blade = topY > groundY;
        hit.near = nr;
        hit.closed = true;
        hit.level = lv;
        hit.p = vec3(p.x, min(p.y, topY), p.z);
        hit.n = vec3(0.0, 1.0, 0.0);
        hit.cell = cell;
        hit.tex = t;
        hit.t = distance(hit.p, eye);
      }
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
    // HOW MUCH MAT STANDS ON THIS COLUMN, in cells, read off the same fetch that
    // carried the height. It is asked here because two things want it: which
    // family the ground draws where the mat thins, and how deep the well goes.
    float matRung = bladeSubOf(hit.tex) * uBladeUnit / uCell;

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
    //
    // AND WHERE THE MAT THINS, THE GROUND IS EARTH AND NOT A GREEN PLANE
    // (R1 S6, and §2.5 for the measurement). Inside the verge of the corridor
    // MANTO.verge leaves a third to two thirds of the columns without a blade,
    // and what showed there was the TOP OF THE COLUMN: flat, level, meadow
    // green, at the full sun and the full sky. The reference never shows that
    // plane -- 0.4 to 0.8% of its frame against ours -- because where its mat
    // thins there is brown earth with cubes standing on it. Probed at the
    // fitted pose the bare column is 7.2% of R1's pp-sx window and 10.6% of the
    // whole five-to-seven metre band, and it carries 23.7% of that band's
    // bright family: it is the second largest single source of the light quota
    // after the mat's own skin.
    //
    // IT IS THE FAMILY THAT MOVES AND NOT A NEW COLOUR. The bare earth of the
    // verge is already solved through the chain (ALBEDO.earth, and the note over
    // it for why it is solved and not quoted); what this says is only that the
    // ground under a thinning mat is that family rather than the meadow's, at
    // the FLOOR of the tint band, which is R1 S6's own prescription and is the
    // darkest the field is allowed to draw without inventing a pigment.
    bool earth = false;
    bool thinMat = false;
    if (!hit.blade) {
      if (onTop) {
        thinMat = family == 0 && matRung < 0.5;
        earth = family == 1 || thinMat;
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
    float tint = thinMat ? uTintFloor
      : uTintFloor + hit.tex.a * (uTintCeil - uTintFloor);
    vec3 albedo = (thinMat ? uAlbedoSoil : earth ? uAlbedoEarth : uAlbedo) * tint
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
    // THE WELL IS BETWEEN THE CUBES, AND WHAT STANDS BETWEEN THEM IS GROUND.
    //
    // WHAT WAS WRONG, MEASURED ON THIS TIP AND NOT INHERITED. Both halves of the
    // mat's own light -- the sun a blade keeps under its own line (uShadeSun)
    // and the ladder it falls down (uBase) -- were gated on hit.blade. So a
    // BLADE was shaded by the mat and the GROUND STANDING IN THE MAT was not:
    // it took the full sun and the full sky, the brightest thing this material
    // draws, in the one place the target is darkest. Probed at the fitted pose
    // over R1's own pp-dx window that ground is 29% of the pixels and 27% of
    // the bright family; over the whole five-to-seven metre band it is 56% of
    // it. It is not the floor of a column seen from above -- at this pose that
    // face is 0.0% of the frame, the mat covers it -- it is the SIDE of the
    // ground the blades stand on, three to five cells under the canopy.
    //
    // AND IT IS WHY THE LADDER COULD NOT BE FITTED FROM OUTSIDE. Swept live over
    // its whole range, including the ceiling, the three literals moved pp-dx by
    // one level and no quota at all: 62% of that window stands at rung nought
    // where pow(base.y, 0) is one and the ladder is arithmetically absent, and
    // everything the gate let through was already in the dark family. R1 S2
    // measured the pozzo worth 49/16/35 -> 60/34/6 on a frame made of 20 cm
    // PLATES, whose flanks were tall; U-CAMPO-1's ring draws real 5 cm blades
    // at this distance now, and a blade has no tall flank. The mechanism had to
    // be re-derived, not re-tuned.
    //
    // WHAT IT COSTS: nothing is fetched. canopy is topYOf(), the ground plus the
    // blade standing on it, so the rung a face is already counting IS its depth
    // under the mat; bladeSubOf() of the same texel is how much mat there is.
    //
    // AND THE MAT ONLY SHADES AS DEEP AS THE MAT IS TALL. Without that line the
    // ladder reaches down a cut bank -- the side of a mound, the halo round a
    // boulder, every terrace of the boundary -- and blackens ground no grass is
    // standing over. Capped at the mat's own height the same arithmetic says the
    // physical thing: a face loses the sky the grass above it takes, and there
    // is no more grass than there is.
    bool inMat = hit.blade || matRung > 0.5;
    float shadeSun = inMat ? uShadeSun : 1.0;
    float lit = 1.0 - smoothstep(0.0, uCell * 0.25, sunLine - lightY);
    float sun = shadeSun + (1.0 - shadeSun) * lit;
    // A BLADE KEEPS ITS FOOT'S FALL; THE GROUND IN THE MAT TAKES THE WELL.
    // Two readings of two different things, and the note over CAMPO_WELL for
    // why keeping them apart is what stops this material from disagreeing with
    // the mesher's about what a blade is.
    vec2 base = !inMat ? vec2(0.0, 1.0) : (hit.blade ? uBase : uWell);
    float rung = min(floor(max(0.0, canopy - hit.p.y) / uCell), floor(matRung));
    float sky = 1.0 - base.x * (1.0 - pow(base.y, rung));
    // AND THE BOUNCE FALLS DOWN THE SAME LADDER (R1 S2). uBounce says a flank
    // sees lit meadow where the hemisphere below it would have been; a flank at
    // the bottom of a well sees the well. Scaling it by the sky that face kept
    // is that statement, made once, for one multiply. face-light.js takes the
    // other side of it by construction -- less sky claimed is more ground
    // returned -- which is what keeps the bottom of the well off nought, and is
    // why the well's LEVEL rises while its quota falls.
    float bounce = hit.blade ? uBounce * sky : 0.0;
    vec3 light = faceLightOf(matTerms(hit.n, sun, sky, bounce));

    // ------------------------------------------------- THE ASPECT, CONSERVED
    // WHY A COARSE CELL IS NOT ALLOWED TO BE A BRIGHT PLATE (R1 S1c, R2 §2.3).
    //
    // Over the ring the cell is bigger than a blade, and the blade it draws is
    // a SAMPLE of the sixteen or sixty four under it (campoReduce, and the note
    // there for why a maximum would draw a flat meadow). The geometry of that
    // is right and it is what makes distance read as cubes. The LIGHT of it is
    // not: a top face at the sampled height, lit as a top face all the way
    // across, where what stands there is a mat -- tops, flanks and the wells
    // between them. Measured, that is the whole of the defect: dark/middle/
    // light 49/16/35 against the target's 57/39/5 at five to seven metres, and
    // a mean luma that JUMPS by three and a half levels at the front, which is
    // what makes a front read as «prato che si genera» rather than as a cube
    // changing size.
    //
    // So the cell carries the STATISTIC of what it covered -- how deep, on
    // average, the mat lies under the top that is drawn for it -- and the light
    // is mixed by it towards the light of that mat: the sun a FLANK takes,
    // averaged over the four bearings a cube shows, and the sky seen from
    // uLookRung of canopy down. Not a second sample and not a texture: one
    // reading of a byte that was already in the fetch, and one more face.
    //
    // AND IT IS THE LIGHT AND NOT THE ALBEDO. The pigment, the grain and the
    // joint are the cubes' own and are left exactly where they were; what a
    // level of detail may change is how much light a face is standing in.
    float look = hit.level > 0 ? lookOf(hit.tex) * uLookGain : 0.0;
    if (look > 0.0) {
      // THE SUN A FACE INSIDE THE MAT TAKES, WHICH IS THE MAT'S OWN SHADOW AND
      // NOT A SECOND OPINION ABOUT IT. What is hidden under the plate is hidden
      // BY THE MAT, so its survival of the sun is the survival this material
      // already carries for exactly that -- uShadeSun, the sun a blade keeps
      // under its own line -- composed with whatever shadow the cell as a whole
      // is standing in. E-LUCE7 measured the same thing on the reference from
      // the other side: half of the target's grass IS its own internal shadow,
      // and a term that lit the hidden half like the top would draw the plate
      // this change exists to remove.
      //
      // AND THE FOUR HORIZONTAL FACES OF A CUBE share their sky and average
      // their sun to (|x| + |z|) / 4 of the bearing, which is the closed form
      // of a mean that would otherwise cost four faceLightOf calls.
      float sunSide = (abs(uSunDir.x) + abs(uSunDir.z)) * 0.25 * sun * uShadeSun;
      float skyUnder = 1.0 - uBase.x * (1.0 - pow(uBase.y, rung + uLookRung));
      light = mix(light, faceLightOf(vec2(sunSide, min(1.0, 0.5 + uBounce) * skyUnder)), look);
    }

    // ---------------------------------------------------- the lightened arris
    float up = fract(p3.y / span);
    float band = min(uArrisPixels * pixel, span * 0.30) / span;
    float arris = smoothstep(1.0 - band, 1.0, up)
      * (1.0 - abs(hit.n.y)) * uArris * smoothstep(2.5, 5.0, onScreen);
    if (arris > 0.0) {
      vec3 leaning = normalize(mix(hit.n, normalize(hit.n + vec3(0.0, 1.0, 0.0)), uArrisLean));
      light = mix(light, faceLightOf(matTerms(leaning, sun, sky, bounce)), arris);
    }

    // ------------------------------------------------- THE LIGHT BY PLACE
    // AND IT MULTIPLIES ALL THREE TERMS AND NOT THE SUN ALONE, which is the
    // one decision in this file that had to be measured rather than argued.
    //
    // R1 S3 writes the term as a factor on the SUN alone, and R1 S3's own
    // reading of the reference is a FACTOR OF 0.31 at the low decile of the
    // luma of its meadow. Those two cannot both be had: measured through the chain, a zone that took the
    // whole of the sun off a top face still leaves it at 0.55 of open meadow,
    // because ../face-light.js hands back as ground return a fraction of ONE
    // MINUS the sky term, and the sky term has not moved. It is the same
    // arithmetic that stops the well of U-PRATO-2 at 0.505 and it stops a
    // sun-only zone in the same place -- at nearly twice the factor the
    // reference shows.
    //
    // What a zone IS also says the same thing. A patch of meadow under a slower
    // sky is not a patch with the sun taken off it and the whole hemisphere
    // still pouring in: sun, sky and the light the ground beside it returns are
    // all down together, which is exactly a factor on the light. So the term is
    // one multiply on the finished light -- after the well, after the aspect,
    // after the arris, so that every one of those keeps its own SHAPE and only
    // the level of the place moves.
    light *= zoneAt(hit.p.xz);

    vec3 colour = albedo * light;
    colour = throughAir(colour, travelled, hit.p.y);
    return vec4(colour, 1.0);
  }

#ifdef CAMPO_RESOLVE

  // ==========================================================================
  //      THE OTHER DOOR INTO THIS PROGRAM: THE RECOMPOSITION THAT MARCHES
  // ==========================================================================
  //
  // THE DEFECT, IN THE COMMITTENTE'S OWN WORDS. «Bordi a scaletta che tremano»
  // on the meadow and on the earth, worse at the low tier. The field asks its
  // question ONCE PER TEXEL of a buffer that stands at a fraction of a side, so
  // the ground is decided at 0.75, 0.43 and 0.38 of a screen pixel; the four
  // taps of the recomposition weigh those texels but by design do NOT blend
  // across an arris, because at the edge of a cube the honest answer is the
  // side the pixel is on. Every silhouette therefore lands on a step of one to
  // three pixels, and the step jumps a whole texel when the view moves by a
  // fraction of one -- which it always does, because the body breathes.
  //
  // U-CAMPO-5 built the temporal memory and took 3 to 20% off the sparkle at no
  // cost at all, and THE STAIRCASE DID NOT MOVE: the plates show the same
  // steps. It cannot move, because a sum of frames each decided at a third of a
  // pixel is still a picture decided at a third of a pixel.
  //
  // THE CURE, AND IT IS THE ROAD THE COMMITTENTE CHOSE. Where the four texels
  // DO NOT AGREE, the pixel stops choosing between them and asks the question
  // itself: one ray, at the frame's own resolution, down the frame's own
  // direction, through the same two pictures, with the same march() and the
  // same shade(). Which is why this is a DEFINE on the field's own program and
  // not a second shader: a second shader would be a second opinion about what a
  // blade looks like, and the one property this campaign is built on is that
  // there is one arithmetic for the ground.
  //
  // WHERE IT DOES NOT MARCH: past uRemarchReach metres from the tap the pixel
  // stands on. At twenty metres a ten centimetre cube is already under the
  // pixel and a step of one pixel is not a step anybody can see; and the reach
  // is the whole of the cost, because both the number of pixels that disagree
  // and the length of the march they would pay grow with what is in frame.
  //
  // WHAT IT DOES NOT TOUCH. Everywhere the four agree this is the
  // recomposition of today, texel for texel, with the memory underneath it if
  // the memory is on -- and the same is true of the marcher's own fragment,
  // which is not one character different. The null is not an argument about a
  // branch either: the handle that is off does not BUILD this program, and the
  // mesh that draws is the one that has always drawn (see campoRemarch and
  // setRemarch in ../voxel/campo-field.js).

  // WHETHER THE EDGE MARCHES AT ALL, and it is a uniform inside a program that
  // only exists when the handle asked for it: the handle decides which MESH
  // draws, and this decides nothing on a frame nobody asked for.
  uniform float uRemarch;
  /** How far from the reference tap, in METRES, an edge is still worth a ray. */
  uniform float uRemarchReach;
  // THE BENCH'S OWN ARM FOR THE DIVERGENCE, and it is a measurement and not a
  // taste. The pixels that disagree are SCATTERED: in a warp of thirty two,
  // four may march and twenty eight wait for them, so the march is paid for by
  // pixels that never take it. At one, every pixel inside the reach marches --
  // the same work laid out coherently -- and the two costs divided by their two
  // pixel counts are what says whether a mask pass would buy anything.
  uniform float uRemarchAll;
  // AND WHERE IT MARCHED, for the count: red where the ray was fired, black on
  // the ground where it was not, in front of everything so a plate can be
  // counted. The sky is left alone, and the arm is counted against the same
  // plate with uRemarch at nought, which is the control.
  uniform float uRemarchShow;
  // THE FRAME'S OWN UNPROJECTION. The quad is handed over in clip space and has
  // no vWorld to take a direction from, so the direction is solved here -- and
  // the same matrix answers the other question, which is how far away in METRES
  // the tap this pixel stands on is, for the reach.
  uniform mat4 uInvViewProjection;
${RESOLVE_UNIFORMS}
  void main() {${RESOLVE_CORE}

    // ---------------------------------------------- AND HERE THE EDGE MARCHES
    //
    // THREE QUESTIONS, AND A PIXEL THAT ANSWERS YES TO ANY OF THEM IS A PIXEL
    // WHOSE FOUR TEXELS ARE NOT DESCRIBING ONE SURFACE.
    //
    //   THE GATE DROPPED A TAP. Two of these taps stand on either side of an
    //   arris, a rim or the lip of a terrace, and their depths are further
    //   apart than the local slope allows -- so the recomposition is already
    //   refusing to average them, rightly, and that refusal IS the step.
    //
    //   THE COVERAGE IS A FRACTION. Some of this pixel is ground and some of it
    //   is not, at the reduced buffer's own resolution.
    //
    //   ONE TAP FOUND GROUND AND ANOTHER FOUND NONE. Which is the same edge the
    //   coverage sees, asked of the taps instead of of their weighted sum, so
    //   that a pixel sitting on a texel centre -- where one weight is one and
    //   the other three are nought, and the fraction collapses -- is not missed.
    //
    // AND THE REACH IS MEASURED TO THE TAP AND NOT ALONG THE RAY, because the
    // ray has not been fired yet: the reference tap's own depth, unprojected at
    // this pixel, is where the ground under this pixel already is.
    if (uRemarch > 0.5) {
      bool anyGround = false;
      bool anySky = false;
      for (int i = 0; i < 4; i++) {
        if (c[i].a > 0.0) anyGround = true; else anySky = true;
      }
      bool disagree = dropped > 0.0 || (cover > 0.0 && cover < 1.0)
        || (anyGround && anySky);
      vec3 eye = cameraPosition;
      vec2 ndc = (gl_FragCoord.xy / uFrameSize) * 2.0 - 1.0;
      vec4 atRef = uInvViewProjection * vec4(ndc, dr * 2.0 - 1.0, 1.0);
      float refDist = distance(atRef.xyz / atRef.w, eye);
      bool go = (disagree || uRemarchAll > 0.5) && refDist <= uRemarchReach;
      if (uRemarchShow > 0.5) {
        fragColour = vec4(go ? 1.0 : 0.0, 0.0, 0.0, 1.0);
        gl_FragDepth = 0.0;
        return;
      }
      if (go) {
        // THE DIRECTION OF THE PIXEL AND NOT OF THE TEXEL, which is the whole
        // of what this buys. Unprojected on the far plane, so it is the ray the
        // frame's own projection draws through this pixel's centre, whatever
        // lens the camera is wearing and wherever the walker is standing.
        vec4 atFar = uInvViewProjection * vec4(ndc, 1.0, 1.0);
        vec3 dir = normalize(atFar.xyz / atFar.w - eye);
        // No axis exactly nought, exactly as the marcher's own fragment nudges
        // them, so that every reciprocal below is a number.
        dir.x = abs(dir.x) < 1e-6 ? 1e-6 : dir.x;
        dir.y = abs(dir.y) < 1e-6 ? 1e-6 : dir.y;
        dir.z = abs(dir.z) < 1e-6 ? 1e-6 : dir.z;
        vec3 inv = 1.0 / dir;
        // WHERE THE RAY ENTERS THE WINDOW, solved and not interpolated, because
        // the box draws its back faces and the walker stands inside it.
        //
        // AND THESE TEN LINES ARE THE MARCHER'S OWN, WRITTEN A SECOND TIME ON
        // PURPOSE. Lifting them into a function both mains call would rewrite
        // the marcher's fragment -- and the marcher's fragment is drawn on
        // every frame, at every tier, whether this handle is on or off, so the
        // one thing it may not do is move a byte of the picture this handle is
        // supposed to leave exactly alone. march() and shade(), which are the
        // hundreds of lines that actually decide what the ground looks like,
        // are not written twice and are the reason this is a define.
        vec3 lo = vec3(uFarBounds.x, uHeight.x, uFarBounds.y);
        vec3 hi = vec3(uFarBounds.z, uHeight.y, uFarBounds.w);
        vec3 ea = (lo - eye) * inv;
        vec3 eb = (hi - eye) * inv;
        vec3 nearT = min(ea, eb);
        vec3 farT = max(ea, eb);
        float tEnter = max(max(nearT.x, nearT.y), max(nearT.z, 0.0));
        float tLeave = min(farT.x, min(farT.y, farT.z));
        if (tLeave > tEnter) {
          // The dither of the detail, the pixel's own and not the frame's, and
          // at the uDither that ships (nought) it is exactly one half and the
          // ladder does not move at all.
          float dither = uDither * (pigHash(gl_FragCoord.x, gl_FragCoord.y) - 0.5) + 0.5;
          Hit hit = march(eye, dir, inv, tEnter, tLeave, dither);
          vec4 own = shade(dir, hit);
          // ITS OWN COLOUR, ITS OWN COVERAGE AND ITS OWN DEPTH.
          //
          // THE COVERAGE OF ONE RAY IS ONE OR NOUGHT, and that is not a
          // shortcut: at the frame's own pixel the question «is this pixel
          // ground» HAS an answer, where at a third of a pixel it only ever had
          // a fraction. It is handed back through «cover» rather than written
          // over 'alpha', so it goes through the same rim rule the reduced
          // buffer's own coverage goes through below and uCoverage keeps
          // meaning what it means.
          //
          // AND NOUGHT IS AN ANSWER TOO. A ray that finds nothing, or that
          // stops on the corridor -- which shade() stands aside on, because
          // src/world/path.js draws that stone -- leaves the coverage at nought
          // and the pixel is discarded below. That is the sharpening this
          // buys at the foot of the paving as much as on an arris: today the
          // recomposition would reach for the heaviest neighbour that found
          // ground and paint a texel of meadow over the kerb.
          //
          // AND THE DEPTH IS THE RAY'S OWN, so the flowers, the feet of the
          // monoliths and the walker keep cutting this pixel exactly where they
          // cut the texels around it -- per whole pixel, as they already did.
          cover = own.a;
          if (own.a > 0.0) {
            rgb = own.rgb;
            vec4 clip = uViewProjection * vec4(eye + dir * hit.t, 1.0);
            depth = (clip.z / clip.w) * 0.5 + 0.5;
          }
        }
      }
    }
${RESOLVE_TAIL}
  }

#else

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
    // The RUN of the ray, as in rise over run: both bounds are slopes.
    float run = length(dir0.xz);
    if (dir0.y > uSkySlope * run) discard;
    // AND THEN THE RING, WHICH IS THE SAME TEST ASKED OF THIS BEARING.
    //
    // The one bound above is the steepest ground ANYWHERE; the ring holds the
    // steepest ground along the way this pixel is looking, which at the pose
    // the campaign judges on is 0.133 against 0.166 at the median bearing. The
    // band between them is 15.0% of the frame, and every ray in it crossed four
    // hundred metres to find nothing. See campoHorizon in ./campo.js: a cell is
    // written into every bearing its own extent can be seen from, widened by
    // the step the walker may take before the ring is counted again, so a ray
    // this throws away is a ray that provably could not have hit anything.
    //
    // THE ORDER IS THE POINT. The cheap compare stands first and takes most of
    // the sky out for one multiply; only what survives it pays the arc tangent.
    int bearing = int(floor((atan(dir0.z, dir0.x) + ${Math.PI.toFixed(8)})
      * ${(CAMPO_BEARINGS / (Math.PI * 2)).toFixed(8)}));
    bearing = clamp(bearing, 0, ${CAMPO_BEARINGS - 1});
    if (dir0.y > uSkyRing[bearing >> 2][bearing & 3] * run) discard;
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
    // Whether any ray of this pixel was CLOSED rather than found: the receipt
    // uDebug 7 paints. See THE TRAVERSAL THAT RAN OUT in march().
    bool closed = false;
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
      // AND THE WHOLE PATTERN MOVES, once per frame and by less than a texel.
      // Nought leaves every ray exactly where phase one aimed it.
      off += uJitter;
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
      if (hit.closed && c.a > 0.0) closed = true;
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
    // uDebug 7 -- WHERE THE TRAVERSAL WAS CLOSED RATHER THAN FOUND. Green, on a
    // frame that is otherwise the frame, so the receipt can be counted with the
    // same plate the law is read off: the assertion of guard-cuciture is that
    // there is no sky, and this is how a guard also asks how much of the meadow
    // is standing on a march that ran out. Magenta above still marks the rays
    // that found nothing at all, which after this cure is the corridor and the
    // columns nobody laid, and nothing else.
    if (uDebug > 6.5 && closed) { fragColour = vec4(0.0, 1.0, 0.0, 1.0); return; }
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
#endif
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
 * @param {object} options.zone     THE MAP OF THE LIGHT BY PLACE, delivered:
 *                                  tools/zone/paint-zone.mjs bakes it and
 *                                  assets-src/assets.d/v1-suolo.json ships it.
 *                                  Nought binds one white texel, which is the
 *                                  world that shipped before it existed.
 * @param {boolean} options.depth   write gl_FragDepth. False prices what the
 *                                  early depth test on this draw is worth.
 * @param {number} options.rays     sub-pixel samples a fragment marches.
 */
export function campoMaterial({
  texture, far = null, sheets = null, zone = null, depth = true, rays = 1,
} = {}) {
  setZoneMap(zone);
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
       * THE RING: how far from the WALKER the mat is drawn whole, in metres.
       *
       * NINE, AND IT IS THE COMMITTENTE'S OWN QUESTION MADE INTO A NUMBER. He
       * asked for «cubi veri dove si guarda»; R1 measured what the target shows
       * inside the near field (blades, their wells, their risers) against what
       * this drew there (plates of twenty and forty centimetres from five
       * metres out), and R2 priced the ring at three sizes on the card: six
       * metres +3.9 ms at the pose the campaign judges on, nine +3.4 to +4.5,
       * twelve +8 to +15. Nine is the largest that stays inside the gate with
       * the reach pulled in, and it is a handle: the address `campolod=R,s`
       * and quality.js's own groundDetail both move it.
       *
       * IT IS FROM THE WALKER AND NOT FROM THE EYE, and it is in METRES and not
       * in pixels. See the head of march() for the two defects that followed
       * from the footprint rule this replaced -- the fronts moving 1.83x with
       * the zoom, and moving with a head that turns.
       */
      uLodNear: { value: 9 },
      /**
       * The factor between one front and the next, under the far window.
       *
       * 1.45, AND THE CONSTRAINT IS THE NEAR WINDOW'S OWN SIZE. Past 19.2 m
       * from the walker there is no picture finer than forty centimetres (see
       * campo-field.js: the near window is 51.2 m of texels and the walker
       * stands in the middle tile of eight), so any law that still wants level
       * two out there gets a ring that JUMPS by 6.4 m whenever the window
       * moves -- measured at 8.2% of the ground in one step. So the third front
       * has to land inside the window: uLodNear * uLodStep^2 <= 19.2, which at
       * nine metres is 1.46 and at six is 1.79. The fronts that ship at the top
       * tier are 9 / 13.05 / 18.92 m.
       */
      uLodStep: { value: 1.45 },
      /**
       * WHERE THE RING IS CENTRED, AND WHY IT LAGS THE WALKER ON PURPOSE.
       *
       * The point the distances are measured from is the walker's own place on
       * the plane, held back until they have left a ball of uLodSnap metres
       * around it (see update() in ./campo-field.js). That is the hysteresis:
       * inside the ball NOTHING changes level at all, so a step taken and taken
       * straight back leaves the frame identical to the byte instead of
       * refining a ring and coarsening it again. It is written by the layer and
       * never by this file.
       */
      uLodCentre: { value: new Vector2(0, 0) },
      /**
       * The other end of the band, the dissolve along it, and which of the two
       * shapes the handle is in. See the note over the uniforms in the shader;
       * campo-field.js is the only writer of all four.
       */
      uLodCentre2: { value: new Vector2(0, 0) },
      uLodFade: { value: 0 },
      uLodMix: { value: 0 },
      /** And whether the grain of the band is on the meadow (1) or the glass. */
      uLodWorld: { value: 1 },
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
      /**
       * HOW MUCH OF A COARSE CELL'S LIGHT THE MAT UNDER IT IS ALLOWED TO OWN.
       *
       * THREE QUARTERS, AND IT IS FITTED AGAINST THE FRONT AND NOT CHOSEN. The
       * byte campoReduce writes is a DEPTH -- how far under the drawn top the
       * mat lies, in the law's own spread -- and what the light needs is a
       * SHARE: how much of the cell the eye is being shown mat instead of
       * plate. The one turns into the other by a factor, and the factor has a
       * measurement that decides it: THE FRONT MUST NOT BE A STEP OF LUMA.
       *
       * Read at the pose the campaign judges on, on the pixels the field itself
       * draws (it draws 31.6% of that frame; a mean over the whole of it
       * dilutes this by three), the band 7-8.5 m against the band 10.5-12.5 m
       * -- one safely inside the ring and one safely outside it, a metre and a
       * half clear of the front either way, because a blade a quarter of a
       * metre tall seen from 1.58 m is hit a metre and a half before its pixel
       * cuts the plane:
       *
       *     the law that shipped (3.41 m x2)   +5.75 levels across the front
       *     ring 9 m, no statistic             +4.08
       *     ring 9 m, share 0.50               +1.97
       *     ring 9 m, share 0.75               +0.28   <- what ships
       *     ring 9 m, share 1.00               -2.27
       *
       * At three quarters the front is a quarter of a level, which is under the
       * grain of the meadow, and R1's «una media che si affina» is what the eye
       * gets instead of «una placca chiara che si spacca in fili scuri». The
       * band beyond the ring lands, at the same value, on 33@55 57@31 98@14
       * against the target's own 32@58 52@26 113@16 at that distance: three
       * shares inside five points, where the law that shipped was out by
       * seventeen on the bright one.
       */
      uLookGain: { value: 0.75 },
      /**
       * HOW DEEP UNDER ITS OWN CANOPY THE MAT'S AVERAGE FACE STANDS, IN CELLS.
       *
       * From MANTO.law and not chosen: the mat's mean height is 2.455 blades,
       * a blade is one cell of this field, and a flank averaged over its own
       * height stands at half of it. Two cells is that number taken in the step
       * the sky term is counted in (uBase's ladder is whole cells), and it is
       * the same fall the near blades take at that depth -- so a plate at the
       * front and the blades just inside it are lit off ONE law, which is what
       * stops the front from carrying a step of luma.
       */
      uLookRung: { value: 2 },
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
      // Ten everywhere until the first count, which is the same thing uSkySlope
      // starts at: a bound nothing is steeper than cuts nothing.
      uSkyRing: {
        value: Array.from({ length: CAMPO_BEARINGS / 4 }, () => new Vector4(10, 10, 10, 10)),
      },
      uViewProjection: { value: new Matrix4() },
      // THE POST CHAIN'S OWN, BY REFERENCE AND NOT BY VALUE. The frame decides
      // the offset because the frame is what owns the buffer the offsets are
      // being added up in; this program only aims the ray it is handed.
      uJitter: CAMPO_JITTER,
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
      uWell: { value: new Vector2(...CAMPO_WELL) },
      uAlbedoSoil: { value: new Vector3(...ALBEDO.soil) },
      uShadeSun: { value: blade.shadeSun },
      uEarthMinStep: { value: EARTH.minStep },
      uEarthToEye: { value: EARTH.toEye ? 1 : 0 },
      ...zoneUniforms(),
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

// ============================================================================
//                      THE RECOMPOSITION, AT FULL RESOLUTION
// ============================================================================
//
// WHAT IT HAS TO DO AND WHAT IT CANNOT DO, said in that order.
//
// It CANNOT invent the edges the reduced buffer did not draw. A cube's arris
// against the meadow behind it was decided by one ray in four pixels, and no
// filter puts back a silhouette nobody marched. What half a side costs is
// exactly that, and it is what the plate at four times life size is for.
//
// What it MUST do is keep the edges that were never the field's to draw. The
// foot of a monolith, the stem of a flower, the walker's own boot: those are
// drawn at the frame's own pixel, into the frame's own depth, and they are in
// the buffer BEFORE this quad is. So this pass writes gl_FragDepth and lets the
// depth test decide, pixel by whole pixel, whether the ground is in front of
// the masonry or behind it. Nothing of the meadow can land on a monolith,
// because a whole pixel of monolith says it may not -- and that is a sharper
// answer than the field itself used to give, which was a half resolution guess
// at a whole resolution question only in the sense that it was the same guess.
//
// AND THE FIELD'S OWN DEPTH EDGES ARE GATED RATHER THAN SMEARED. Four texels
// surround this pixel. Read them bilinearly and a pixel sitting where a raised
// cube meets ground four metres behind it gets the MEAN of two depths, which is
// a place in the air between them -- and a flower standing at the foot of that
// cube then cuts into nothing at all. So the four are gated on depth first: a
// tap more than a tolerance away from the tap this pixel actually falls in is
// dropped, and what is left is weighed bilinearly.
//
// THE TOLERANCE IS THE LOCAL SLOPE AND NOT A NUMBER. Window depth is affine in
// screen space over any PLANE -- that is the property the hardware's own
// interpolator is built on -- so four taps of a meadow seen at a grazing angle
// disagree hugely and are all on one surface, while four taps across a cube's
// edge disagree by more than any plane through them could account for. The gate
// is therefore `uEdge` times the local difference plus a floor, and the local
// difference is taken as the SMALLER of the two parallel ones on each axis, so
// an edge crossing one of them cannot inflate the tolerance that is supposed to
// catch it.
//
// AND THE COVERAGE IS FINALLY SPENT. The field has always computed it -- the
// share of a pixel's rays that found ground -- and has always thrown it away,
// because the scene buffer is a packed float with no alpha to put it in. The
// reduced buffer has four channels, so here the rim of the ridge against the
// sky arrives as a fraction and is blended against the sky that is already in
// the frame. `uCoverage` at nought puts back the binary rim that shipped, which
// is the null this is measured against.
const RESOLVE_VERTEX = /* glsl */`
  void main() {
    // No matrix at all: the two triangles are given in clip space and stay
    // there. A quad that went through the camera would be a quad that could be
    // clipped by the near plane of a walker standing in the wrong place.
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const RESOLVE_FRAGMENT = /* glsl */`
  precision highp float;
  precision highp int;

  out vec4 fragColour;
${RESOLVE_UNIFORMS}  uniform float uDebug;

  void main() {${RESOLVE_CORE}${RESOLVE_TAIL}
  }
`;

/**
 * The mesh that puts the reduced field back at the frame's own pixel.
 *
 * IT IS A MESH IN THE WORLD AND NOT A PASS IN THE POST CHAIN, and that is the
 * whole of why this is cheap. The field ships at renderOrder 10 -- last of the
 * opaques, behind the sky and the skyline, in front of the transparent flowers
 * -- and every one of those relations is load bearing. Standing here, the
 * recomposition inherits all of them for nothing: it is drawn where the field
 * was drawn, in the one render into the scene target that the frame is allowed,
 * with the same depth test against the same buffer.
 *
 * @param {object} seat  the field's own uniforms from src/core/post.js, shared
 *                       BY REFERENCE: the chain writes the buffer and its size
 *                       once a frame and this material sees the new value,
 *                       because there is one object behind every copy.
 */
export function campoResolve(seat) {
  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms: {
      ...seat,
      uFrameSize: { value: new Vector2(1, 1) },
      // Two of the local slope, which is the tolerance a plane needs and an
      // arris does not: measured over the four taps rather than assumed, so a
      // meadow seen at a grazing angle -- where the depth across one texel
      // changes more than a whole cube does at fifty metres -- is still one
      // surface to this gate.
      uEdge: { value: 2.0 },
      // And a floor under it, in raw depth units, so four taps that agree to
      // the bit on a flat floor do not gate each other out on the buffer's own
      // quantisation.
      uEdgeFloor: { value: 1e-5 },
      uCoverage: { value: 1 },
      uDebug: { value: 0 },
    },
    vertexShader: RESOLVE_VERTEX,
    fragmentShader: RESOLVE_FRAGMENT,
    // THE COVERAGE HAS TO REACH THE BLENDER, and NormalBlending would not get
    // it there: three turns a material that is `transparent: false` and
    // normally blended into NO blending at all, which is exactly why the
    // field's own alpha has never been spent. Asked for by name, it survives --
    // and `transparent` stays false, which is what keeps this draw in the
    // OPAQUE pass where the field has always been, in front of the sky and
    // behind the flowers.
    blending: CustomBlending,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
    transparent: false,
    // Two triangles handed over in clip space, so which way they face is a
    // property of the geometry and not of where anybody is standing.
    side: DoubleSide,
    fog: false,
    depthWrite: true,
    depthTest: true,
  });

  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.name = 'ground-campo-resolve';
  mesh.frustumCulled = false;
  // THE SAME PLACE IN THE ORDER THE FIELD ITSELF HELD. See campoBox: after
  // every other opaque, so the sky and the skyline are already in the buffer
  // for the coverage to stand against and every monolith is already in the
  // depth for the test to answer with.
  mesh.renderOrder = 10;
  mesh.onBeforeRender = (renderer) => {
    // The frame, in pixels, read from the target that is actually bound rather
    // than from the canvas: this pass is the one place where the two are the
    // same and the field's own pass is the one place where they are not.
    const target = renderer.getRenderTarget();
    if (target) SCRATCH.set(target.width, target.height);
    else renderer.getDrawingBufferSize(SCRATCH);
    material.uniforms.uFrameSize.value.copy(SCRATCH);
  };
  return mesh;
}

/**
 * THE DEFAULT REACH OF THE RE-MARCH, IN METRES.
 *
 * TWENTY, and the argument is a size and not a taste. A ten centimetre cube at
 * twenty metres subtends 0.10 / 20 = 5 milliradians; one pixel of the high
 * tier's frame at 44.2 degrees over 845 rows subtends 0.96 milliradians of
 * height, so the cube is about five pixels and ITS ARRIS is under one -- which
 * is the distance at which a step of one pixel stops being a step and starts
 * being the edge itself. Past it the reduced texel is the honest answer and the
 * ray would be paid for nothing. It is the one lever the cost is in, so it is a
 * handle (`camporimarcia=1,PORTATA`) and it is measured at 10, 20 and 40 in the
 * verbale rather than argued here.
 */
export const CAMPO_REMARCH_REACH = 20;

/**
 * THE OTHER HALF OF THE RECOMPOSITION: THE ONE THAT CAN MARCH.
 *
 * Same quad, same order, same blending and the same gate as campoResolve --
 * because it is the same text (RESOLVE_CORE, RESOLVE_TAIL) -- with the field's
 * whole program under it, so that a pixel whose four texels disagree can fire
 * its own ray through march() and shade() instead of choosing between them.
 *
 * THE UNIFORMS ARE THE FIELD'S OWN, BY REFERENCE AND NOT BY COPY. Spreading
 * them takes the `{ value }` holders themselves, so every writer the field
 * already has -- the window's bounds, the ring of the detail, the zone as it
 * lands, the sun, the cut -- reaches this program on the same frame it reaches
 * the marcher, and there is no second place keeping a stale answer. FOUR are
 * deliberately NOT shared, and each of them is a property of the pass and not
 * of the world:
 *
 *   uPixelScale, WHICH IS THE WHOLE OF POINT SEVEN. Every term of shade() that
 *   filters below the pixel -- the joint, the arris, the prefilter that widens
 *   a slim blade -- divides by the footprint of one pixel, and the marcher's
 *   own is the footprint of a texel of a buffer at 0.75 or 0.5 of a side. A ray
 *   fired at the FRAME's pixel and filtered at the texel's would draw a joint
 *   two and a half times too wide on the very pixels this exists to sharpen. So
 *   this material reads the buffer that is bound when IT draws, which is the
 *   frame.
 *
 *   uViewProjection and uInvViewProjection, the same matrix in both
 *   directions: the quad is handed over in clip space and has no vWorld, so the
 *   ray is unprojected rather than interpolated, and the depth it writes goes
 *   back through the forward matrix exactly as the marcher's does.
 *
 *   uJitter, WHICH IS NOUGHT HERE AND STAYS NOUGHT. The sub-texel offset exists
 *   so that a ground sampled once per texel may be sampled somewhere new each
 *   frame and the frames added up; the accumulation is the reduced buffer's and
 *   this pixel is not in it. A re-marched edge has ONE ray and no history --
 *   the same bargain the masonry has always had -- and moving it under nothing
 *   would be the sparkle of U-CAMPO-5's second arm with no sum to pay for it.
 *
 * @param {object} seat   the chain's own four, from campoUniforms()
 * @param {object} field  the marcher's material, for its uniforms
 * @param {object} gate   the plain recomposition's uniforms, so the tolerance
 *                        of the gate and the rim rule are ONE object for both
 *                        halves and a bench cannot move one without the other
 * @param {number} reach  how far an edge is worth a ray, in metres
 */
export function campoRemarch(seat, field, gate = null, reach = CAMPO_REMARCH_REACH) {
  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    defines: { CAMPO_RESOLVE: '1' },
    uniforms: {
      ...field.uniforms,
      ...seat,
      uFrameSize: { value: new Vector2(1, 1) },
      uEdge: gate ? gate.uEdge : { value: 2.0 },
      uEdgeFloor: gate ? gate.uEdgeFloor : { value: 1e-5 },
      uCoverage: gate ? gate.uCoverage : { value: 1 },
      uRemarch: { value: 1 },
      uRemarchReach: { value: reach },
      uRemarchAll: { value: 0 },
      uRemarchShow: { value: 0 },
      /**
       * WHOSE PIXEL THE FILTERS BELOW THE PIXEL ARE MEASURED IN, AND IT IS A
       * BENCH ARM AND NOT A TASTE.
       *
       * Nought -- what this material is for -- is the FRAME's, because that is
       * the resolution the ray is fired at. One is the reduced TEXEL's, which
       * is wrong for a ray fired at the frame's pixel and is exactly why it is
       * here: every term of shade() and march() that filters below the pixel
       * divides by this, and one of them is not a shading term at all. It is
       * the prefilter that widens a slim blade back to its whole cell where the
       * cell is no bigger than a couple of pixels (see the inset in march()),
       * and at the frame's footprint that widening lets go two and a half times
       * further out -- so a re-marched pixel draws a blade SLIM where the texels
       * beside it drew it FAT. That is a difference of geometry and not of
       * light, and whether it is a part of what the re-march costs in
       * frame-to-frame change is a number and not an argument. This is how the
       * number is taken.
       */
      uRemarchFoot: { value: 0 },
      uViewProjection: { value: new Matrix4() },
      uInvViewProjection: { value: new Matrix4() },
      uPixelScale: { value: 0.002 },
      uJitter: { value: new Vector2(0, 0) },
    },
    vertexShader: RESOLVE_VERTEX,
    fragmentShader: FRAGMENT,
    blending: CustomBlending,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
    transparent: false,
    side: DoubleSide,
    fog: false,
    depthWrite: true,
    depthTest: true,
  });

  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.name = 'ground-campo-remarch';
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    const u = material.uniforms;
    const target = renderer.getRenderTarget();
    if (target) SCRATCH.set(target.width, target.height);
    else renderer.getDrawingBufferSize(SCRATCH);
    u.uFrameSize.value.copy(SCRATCH);
    // THE FRAME'S OWN FOOTPRINT, the same arithmetic campoBox does for the
    // marcher and read off the buffer that is bound HERE, which is the frame.
    // The bench may ask for the reduced texel's instead; see uRemarchFoot.
    const fov = (camera.fov ?? 45) * Math.PI / 180;
    const rows = u.uRemarchFoot.value > 0.5 && u.uCampoSize.value.y > 1
      ? u.uCampoSize.value.y : SCRATCH.y;
    u.uPixelScale.value = rows > 0 ? 2 * Math.tan(fov / 2) / rows : 0.002;
    u.uViewProjection.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    u.uInvViewProjection.value.copy(u.uViewProjection.value).invert();
  };
  return mesh;
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
    //
    // AND THE BUFFER IS THE ONE THAT IS BOUND, not the canvas. The two are the
    // same on every frame drawn whole -- the scene target is the drawing buffer
    // -- and they are exactly not the same on the frame this field is drawn
    // apart at half a side. What every term below the line spends this on is
    // sub-pixel filtering: the blade's prefilter, the joint, the arris. That is
    // the scale the SUB-SAMPLING lives at (U-CAMPO-1 §9, RESTA: «ogni termine
    // in pixel ... sono la scala del sotto-campionamento e devono esserlo»), so
    // a field marching into a buffer of half the side and filtering as though
    // it were marching into the whole one would alias by construction. The LOD
    // itself does not move: it is a distance in metres from the walker and
    // names no pixel at all, which is guard-zoom's own assertion.
    const bound = renderer.getRenderTarget();
    const size = bound ? SCRATCH.set(bound.width, bound.height)
      : renderer.getDrawingBufferSize(SCRATCH);
    const fov = (camera.fov ?? 45) * Math.PI / 180;
    u.uPixelScale.value = size.y > 0 ? 2 * Math.tan(fov / 2) / size.y : 0.002;
    if (onRenderer) onRenderer(renderer);
  };
  // The frustum cannot help here and can only hurt: the box is the ground the
  // walker stands in the middle of, so it is always in view, and a bounding
  // sphere recomputed as it moves is main thread work for an answer that never
  // changes.
  mesh.frustumCulled = false;
  // ITS OWN LAYER, ALWAYS, WHETHER OR NOT ANYBODY TAKES IT OFF THE WORLD'S
  // PASS. The frame decides which of the two it draws -- the field here, at the
  // frame's own pixel, or the field into a buffer of its own and this quad's
  // twin over the top of it -- and it decides it by enabling or disabling this
  // layer on the camera. A mesh that changed layer when the tier moved would be
  // a second place the same decision is written down.
  mesh.layers.set(CAMPO_LAYER);
  // AFTER EVERY OTHER OPAQUE. The field writes gl_FragDepth, so it has no early
  // depth test of its own; what it can still have is everybody else's depth
  // already written, which kills its fragments behind the monoliths at the late
  // test instead of shading them -- and it is also what lets a partly covered
  // pixel blend against a sky and a skyline that are already there.
  mesh.renderOrder = 10;
  return mesh;
}
