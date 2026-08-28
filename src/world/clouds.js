import {
  BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector2, Vector3, Vector4,
} from 'three';
import { CLOUD_DITHER_GLSL, SUN_DIRECTION } from '../core/sky.js';
import { EYE_HEIGHT, SPAWN } from './layout.js';
import {
  arcOf, atlasLayout, coeffsFor, relightGlsl, textureLetter,
} from './cloud-relight.js';
import CLOUDS from '../../assets-src/clouds/clouds.json';

// The weather, drawn as bodies.
//
// The dome behind these carries no weather: a picture of cloud wrapped on a
// sphere a metre from the eye turns with the walker instead of standing still,
// and the reference's cloud is kilometres away. So each mass is a flat quad out
// beyond everything else in the world, carrying a piece of the reference's own
// photograph, cut in the tangent plane of its own bearing by
// tools/clouds/bake-sprites.mjs. At the reference pose the quad's projection and
// the frame's projection are the same projection, so what it draws there is the
// photograph, not a likeness of it.
//
// The dome carries no veil either, and no longer can: it is evaluated from a
// physical model and has no way to hold a photograph. The veil was the last
// piece of the reference's own sky standing in front of it, and it went with
// the rest of the measured material — see src/core/sky.js for why none of it
// may come back.
//
// Three properties of the drawing are load bearing, and none of them is free:
//
// NO PLANE CROSSES A PRISM. A quad that intersects a box draws a ruled line
// along the intersection, and no texture work hides it. The soft particle fade
// that would — reading the depth buffer and dissolving the sprite as it
// approaches whatever is behind it — was built and measured on the earlier
// version of this world and cost ten milliseconds a frame, because it breaks the
// render pass to copy a multisampled attachment. So the sprites are placed
// wholly in front of or wholly behind everything they overlap in bearing, and
// checkPrismClearance below states that as an invariant and checks it, rather
// than leaving it to be discovered in a screenshot.
//
// EVERY SPRITE IS ONE DRAW. They are static — a composition, not a simulation —
// so their order back to front is settled once, here, and they are welded into a
// single geometry whose triangles are already in it. Thirty five meshes sorted
// per frame would be thirty five draws and a sort, to arrive at the order this
// one has by construction.
//
// THE SILHOUETTE IS THE GEOMETRY. A rectangle round a cumulus is mostly empty
// and every empty texel of it is a fragment the frame blends and throws away.
// A convex hull is barely better, because a bank is not convex: an octagon
// fitted to the hero's coverage still covered five sixths of the rectangle, and
// measured on this machine the field cost nine tenths of a millisecond for a
// coverage of one part in nine. So the bake divides each tile into cells a
// couple of degrees across, keeps the ones with cloud in them, and this draws
// those as quads.

const DEG = Math.PI / 180;

// The scale the atlas and the equirect of the same bake both store colour
// against. Exported because the surfaces that reflect the sky multiply by it
// too, and two copies of it would be two chances to disagree.
export const CLOUD_LEVEL = CLOUDS.atlas.levelScale;

// Where the sprites hang, in metres.
//
// Behind everything the world draws — the furthest ridge stands at 420 and the
// largest of the distant giants at 520 — and well inside the far plane, whose
// nearest business is the band of air at 700. Far enough that the walker's
// twenty metres of ground move them by a degree and a quarter, which is the
// parallax a cloud at this distance has and not a defect; near enough that the
// whole field is inside the frustum from every standing place.
const DISTANCE = 900;

// Where the bearings and heights in the manifest were measured from: the eye at
// the reference pose. Anchoring the field here rather than at the origin is what
// makes those numbers mean at the reference pose exactly what they meant in the
// photograph.
const ORIGIN = new Vector3(0, EYE_HEIGHT, SPAWN.z);

// How much clearance a sprite must keep from any box it overlaps in bearing.
const PRISM_CLEARANCE = 60;

// How far the world's sun may be from the one the atlas was cut under before
// this says so. A tile that stands where it was photographed is not relit at
// all — its two suns are the same vector and the ratio is one — so a sun that
// has moved makes those tiles wrong in a way nothing here can correct. Half a
// degree is under the accuracy the fit claims for the sun's own bearing.
const SUN_DRIFT_LIMIT = 0.5 * Math.PI / 180;

// How far the world's light may sit off the PLANE of the arc the generated
// pieces were baked along before this says so, in degrees.
//
// A degree is what the manifest's rounded bearings are worth plus a margin: the
// arc is recovered from samples written to a tenth of a degree, and a recovery
// that good has no business complaining about its own rounding. Anything above
// this is a real direction the ring does not contain.
const ARC_PLANE_LIMIT = 1;

// WHICH WEATHER THIS BUILD SHIPS, and it is a property of the delivery.
//
// Three fields have been built for this sky, and only one of them is ever
// drawn. The first was cut out of the reference's own photograph and carried
// its monolith-shaped bites with it. The second was generated offline, whole by
// construction and lightable from any direction, and it took precedence over
// anything photographic for exactly that reason — the day it shipped, it won.
// The third is this one: pieces ingested from reference PLATES, whole
// silhouettes as well, photographic material at a scale the generator could not
// reach.
//
// The third and the first are the same shape of file and are drawn by the same
// material, so nothing in the numbers tells them apart. The manifest says which
// chain wrote it, and that word is what settles the precedence: a plate
// delivery is the weather, and the generated atlas is not asked for. It is not
// a setting anybody can get wrong, and it is not a second sky kept in parallel.
//
// AND THE WALK THAT RETIRES THE SECOND HAS NOW HAPPENED. The generated atlas
// and its table were kept in the delivery against that walk and were never
// once drawn by it: four entries, 2 436 131 B, carried to every visitor of a
// manifest whose own `source` said the runtime draws the other field. They are
// out of the tree and out of the assets, and what stays is this path and the
// bake that writes it — so bringing the generated field back is a repack and
// four entries in assets-src/assets.json, not a rewrite. Nothing but this line
// keeps it out of the frame.
export const PLATE_FIELD = CLOUDS.source === 'plates';

// Which of the atlas's tiles are standing in the world.
//
// Every piece of weather the reference itself shows, at the bearing and the
// height it shows it at. The library is not among them: it is a set of pieces,
// and where those pieces stand is a separate question, answered by the
// placements the bake wrote beside them. Nor is the veil, which is not weather
// and is no longer drawn here at all.
const STANDING = new Set(['hero', 'mass']);

// ----------------------------------------------------------------- the motion
//
// A sky that does not move is a photograph, and a walker standing still in
// front of one knows it within seconds. Two things move here, and they are
// different things because the eye reads them differently.
//
// THE DRIFT is the whole field turning about the walker, and it is stated as an
// ANGULAR rate rather than as a wind in metres a second. The reason is that the
// distance these sprites hang at is not a distance a cloud has: it is the radius
// that puts the reference's own bearings back where the reference measured them.
// A wind speed divided by it would be a number about that radius. What the eye
// actually reads is degrees of sky a second, and at the reference framing this
// rate is one and a half pixels a second at the centre of the frame and a little
// over two at its edge — slow enough that nothing jumps, fast enough that a
// minute of standing still is a minute of visible weather.
//
// It is one rate for every sprite, which makes the whole sky a rigid rotation
// about the vertical. That is what a bank of cloud at one altitude does when the
// wind blows, and it is also what lets the water reflect the same motion for the
// price of an offset (see skyReflection in core/sky.js): a rotation about the
// vertical is a shift along the equirect's first axis, exactly.
const DRIFT_RATE_DEG = 0.07;

// How far a sprite may ever get from where the reference put it.
//
// The profile is A·tanh(rate·t/A): monotone, so the wind never turns round;
// continuous, so there is no wrap and no jump; and asymptotic to A, so the
// composition can never degrade past a stated bound however long the session
// lasts. The price is stated too — after about three time constants the
// translation is spent and the life is all in the churn.
//
// A mass carries the reference's own composition: it stands between two blocks
// and closes the gap between them, and two degrees is what that duty can afford.
// The library carries nothing but sky, across bearings the photograph never
// showed, so it is given the excursion that reads as weather rather than the one
// that protects a framing.
const ARC_MASS_DEG = 2.2;
const ARC_LIBRARY_DEG = 7;

// The churn: the internal turbulence, as a warp of each sprite's own texture
// domain. It is what keeps a mass alive once its translation has saturated, and
// it never saturates itself, because the field it warps by is ADVECTED — the
// pattern travels downwind and never returns, while the displacement at a fixed
// point of the sprite oscillates, which is what a still observer sees a real
// cloud do.
//
// Amplitude as a fraction of the sprite's own axis, and the three waves below
// are anisotropic on purpose: almost all of it along the sprite's u, very little
// across it. Vertical motion is forbidden — a low shelf closing the horizon must
// not lift off it — and this is where that is enforced.
const CHURN_AMP = 0.036;
const CHURN_SCALE = 0.90;
const CHURN_RATE = 1 / 40;

// ------------------------------------------------------------ the air between
//
// THE WEATHER IS KILOMETRES AWAY AND THE AIR IN BETWEEN IS NOT EMPTY.
//
// Measured on the reference, band of elevation by band: the cloud in it dims and
// greys towards the horizon — 203 display levels of body at fourteen degrees of
// elevation against 163 at two, and a Weber contrast against its own sky that
// falls from 0.58 high in the frame to 0.22 low in it. The generated weather had
// no such term: 218 levels at two degrees and 218 at fourteen, one contrast at
// every height, which is what makes a piece read as an object a few hundred
// metres off rather than as weather over the mountains.
//
// The shape is the one the air has. A deck of cloud at one altitude is seen
// through a slant path that goes as one over the sine of the elevation, so the
// haze between the eye and it is a baseline plus that, and what survives is an
// exponential of the pair.
//
// AND IT COSTS NOTHING TO EVALUATE, because of an identity worth stating rather
// than hiding. What aerial perspective does is mix the body towards the light of
// the air in that direction, and the light of the air in that direction is
// exactly what is ALREADY IN THE FRAME BUFFER under this fragment: the dome is
// opaque, it is drawn before every transparent surface, and this material blends
// over it premultiplied. Writing mix(C, sky, f) with coverage a produces
//   C·a·(1−f) + sky·(1 − a·(1−f))
// and writing C with coverage a·(1−f) produces the same expression, term for
// term. So the term is a MULTIPLIER ON THE COVERAGE, no evaluation of the sky
// model, no second texture read, and — the part that matters for the night — the
// colour it fades towards is whatever the sky is at that moment, because it is
// the sky itself and not a copy of it. A dusk preset moves the dome and the
// weather's haze together, or moves neither.
//
// x: the depth the whole sky carries, which is the softening the reference has
//    everywhere; y: the depth of one unit of slant path; z: the sine of the
//    elevation the path is clamped at, so that a piece on the horizon has a
//    finite haze rather than an infinite one; w: the most of a piece the air is
//    ever allowed to take, so nothing can dissolve completely.
// The four are a fit, and what they were fitted to is the reference's own fall
// of contrast with height: 0.22 against its sky at two degrees of elevation
// against 0.58 at twenty two, a ratio of 0.38. These give 0.46, which is the
// same law an eighth off, and the eighth is inside the spread of the six bands
// the ratio was read from. What they must NOT be fitted to is the reference's
// contrast in absolute terms: that photograph's sky is forty display levels
// brighter than this dome in the bands the weather occupies, so matching the
// number would mean greying the cloud down to meet a sky it is not standing in.
// Measured on the two frames the committente himself judged, global contrast is
// 0.76 in the one he called grandiosa and 0.70 in the one he rejected — it was
// never what he was seeing.
const AERIAL = [0.13, 0.030, 0.030, 0.70];

// How long the churn takes to reach its amplitude, in seconds.
//
// Without it the warp is a static deformation at t = 0 rather than nothing at
// all, and the frame the walker arrives on would be the reference's composition
// warped by three per cent — which is a fifth of a degree of hero bank, and
// visible. With it, the first frame is the photograph exactly, and the sky
// starts breathing from there.
const CHURN_RISE = 8;

// Where the whole field turns about: the eye of the reference pose, which is
// what the bearings in the manifest were measured from.
const PIVOT = [0, SPAWN.z];

// Two irrational steps round the unit interval, so that no two sprites churn in
// step and the set never repeats however many pieces are laid.
const PHASE_STEP = [0.7548776662, 0.5698402909];

/** A number as a GLSL literal, so a constant of this module cannot drift from the shader's. */
const glsl = (value, digits = 8) => value.toFixed(digits);

// The vertex shader, in the one shape both materials share.
//
// `relit` is null for the photographic field and, for the generated one, how
// many pieces stand and how many textures the atlas ships. The generated field
// carries no per-vertex sun at all: what a piece needs for a direction of the
// light is one gain per map and one offset, the same numbers for every vertex
// of that piece, so they come in as a uniform indexed by the piece — which is a
// handful of numbers a frame against three vectors a vertex, and is why moving
// the sun costs this field nothing to upload.
//
// They arrive as one vector per TEXTURE rather than as a flat array of gains,
// so that a vector and the channels it multiplies are the same four things in
// the same order: the fragment's whole angular arithmetic is then one dot
// product per texture and no indexing at all.
const cloudVertex = (relit) => /* glsl */`
  ${relit ? '' : `
  attribute vec3 aSun;
  attribute vec3 aSource;
  attribute vec3 aGrad;
  attribute float aLevel;
  varying vec3 vSun;
  varying vec3 vSource;
  varying vec3 vGrad;
  // What the sky this CORNER stands in front of is worth against the sky the
  // piece was calibrated against — see aLevel where the field is built.
  varying float vLevel;`}
  ${relit ? `
  attribute float aPiece;
${relit.letters.map((L) => `  uniform vec4 uGain${L}[${relit.pieces}];`).join('\n')}
${relit.letters.map((L) => `  varying vec4 vGain${L};`).join('\n')}` : ''}
  // Where this corner of the sky is, from the eye. A mass twenty degrees tall
  // has twenty degrees of different air in front of it, so the haze is a
  // property of the FRAGMENT and not of the piece.
  varying vec3 vDir;
  attribute vec3 aFrame;
  attribute vec3 aLife;
  attribute vec4 aTile;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vFrame;
  varying vec4 vTile;
  varying vec2 vChurn;

  // The excursion, as A·tanh(rate·t/A) written as 1 − 2/(e^{2x}+1).
  //
  // Monotone, so the wind never turns round; exactly nought at t = 0, so the
  // frame the walker arrives on is the reference's own composition; and
  // asymptotic to A, so no length of session can move a mass past its budget.
  // The argument is capped because past a dozen time constants the difference
  // from one is below a float, and an exponential of a thousand is not.
  float excursion(float arc) {
    // A piece with no budget does not move, and is not asked to divide by it:
    // at t = 0 the quotient below is nought over nought, which is not a number
    // and is not zero either.
    if (arc <= 0.0) return 0.0;
    float x = min(12.0, ${glsl(DRIFT_RATE_DEG * DEG)} * uTime / arc);
    return arc * (1.0 - 2.0 / (exp(2.0 * x) + 1.0));
  }

  void main() {
    vUv = uv;
    ${relit ? `
${relit.letters.map((L) => `    vGain${L} = uGain${L}[int(aPiece)];`).join('\n')}` : `
    vSun = aSun;
    vSource = aSource;
    vGrad = aGrad;
    vLevel = aLevel;`}
    vFrame = aFrame;
    vTile = aTile;
    vChurn = aLife.yz;

    // The drift is a rotation of the point about the vertical through the eye
    // the field was anchored to, which is the same thing as adding to the
    // sprite's bearing: the radius, the height and the plane the quad lies in
    // all come out of it unchanged, so the clearance from every prism in the
    // world is invariant by construction rather than by a margin.
    float phase = excursion(aLife.x);
    float c = cos(phase);
    float s = sin(phase);
    vec2 d = position.xz - vec2(${glsl(PIVOT[0], 3)}, ${glsl(PIVOT[1], 3)});
    vec3 world = vec3(
      ${glsl(PIVOT[0], 3)} + d.x * c - d.y * s,
      position.y,
      ${glsl(PIVOT[1], 3)} + d.y * c + d.x * s);
    vDir = world - cameraPosition;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
  }
`;

// What both materials do before either of them knows what a texel means: find
// the point of its own tile the churn has moved this fragment to.
//
// `edge` is half a texel of the FIRST texture, in the atlas's own units, and
// that is the whole clamp however many textures the atlas ships. A texture at
// half the side taps a quarter of a texel further out than this holds, so it
// can reach into the gutter, and the gutter is written nothing — but the
// coverage there is nought, measured, on the border of every packed tile and
// on the ring inside it, because a generated silhouette is WHOLE by
// construction. Everything this material emits is multiplied by that coverage,
// so what a coarse tap reads outside the tile is multiplied by zero. The
// property is the packing's; the day a piece is packed with cloud touching its
// own border, this clamp is the thing that has to grow.
const cloudCommon = (edgeU, edgeV) => /* glsl */`
  precision highp float;
  uniform float uTime;

  varying vec2 vUv;
  varying vec3 vFrame;
  varying vec4 vTile;
  varying vec2 vChurn;
  varying vec3 vDir;
  uniform vec4 uAerial;
  // How much of that air THIS atlas has not already paid: one for material
  // carrying no haze of its own, nought for a photograph that has all of it
  // baked in. It is one minus the manifest's aerialBaked, and it is a number
  // per delivery because it is a property of where the pixels came from.
  uniform float uAerialOwed;

  // How much of this piece the air in front of it has taken, and why the answer
  // is applied to the COVERAGE — see the note over AERIAL in this module. Two
  // exponentials' worth of arithmetic and no read at all.
  //
  // It lives here, in what both materials share, because it is a property of
  // THIS WORLD's air and not of how a piece was made. For four sessions it sat
  // in the generated material alone, and the field the walker was actually
  // being shown — the plates — went through the other one and paid nothing:
  // measured on the running page, setAerial answered null and a term set to
  // five changed the frame by two hundredths of a display level. What each kind
  // of material owes is a per-atlas number and it is uAerialBaked below, not
  // the presence or absence of these four lines.
  float aerialVeil(vec3 toCloud) {
    vec3 d = normalize(toCloud);
    float depth = uAerial.x + uAerial.y / max(d.y, uAerial.z);
    return min(uAerial.w, 1.0 - exp(-depth));
  }

  // The atlas's own dither. It lives beside the dome's in src/core/sky.js
  // because this is blended over that, and two noises drawn from the same
  // number are one noise of twice the amplitude.
  ${CLOUD_DITHER_GLSL}

  // The churn, and why it is a field of ZERO DIVERGENCE.
  //
  // Three shear waves. Each displaces the domain perpendicular to its own wave
  // vector, and a sum of displacements perpendicular to their own wave vectors
  // has divergence exactly nought: to first order the map preserves area, so no
  // bright core is ever concentrated and no filament is ever thinned into a
  // hot speck. It is also the physical shape — turbulence in an incompressible
  // fluid is shear, not compression.
  //
  // And the field is ADVECTED rather than oscillating. The phase carries the
  // whole pattern towards the sprite's downwind edge, so the pattern never
  // returns; what oscillates is the displacement at a fixed point of the
  // sprite, which is what a cloud does to somebody standing still. The three
  // resulting frequencies — a wave's own crossing rate — are 0.029, 0.020 and
  // 0.038 Hz, periods of 34, 49 and 26 seconds, incommensurable, so the field
  // never comes back to a state it has been in.
  // How much of its amplitude the churn has reached, handed over rather than
  // worked out per fragment. It is a function of the clock alone — one number
  // for the whole field — and an exponential taken a million times a frame to
  // arrive at the number the frame already knows is the most expensive thing in
  // this shader after the two reads of the atlas.
  uniform float uRise;

  vec2 churn(vec2 p, float flip) {
    // Downwind is the sprite's +u where it stands as cut and its −u where it
    // was mirrored, so that every piece of weather travels the same way round
    // the compass rather than half of them against the other half.
    float u = p.x - flip * ${glsl(CHURN_RATE)} * uTime;
    vec2 q = vec2(u, p.y) + vChurn;
    float s1 = sin(6.28318531 * (q.x * ${glsl(1.3 * CHURN_SCALE)} + q.y * ${glsl(1.9 * CHURN_SCALE)}));
    float s2 = sin(6.28318531 * (q.x * ${glsl(0.9 * CHURN_SCALE)} - q.y * ${glsl(1.7 * CHURN_SCALE)}));
    float s3 = sin(6.28318531 * (q.x * ${glsl(1.7 * CHURN_SCALE)} + q.y * ${glsl(2.9 * CHURN_SCALE)}));
    // The weights are each wave's own perpendicular, already normalised, times
    // its share of the amplitude: 0.55, 0.25 and 0.20. What comes out is 3.1%
    // of the axis along u and 1.9% across it — the anisotropy IS the wind, and
    // the small figure across is what keeps a shelf's base on the horizon.
    vec2 offset = vec2(
      0.4540 * s1 - 0.2209 * s2 + 0.1725 * s3,
      -0.3106 * s1 - 0.1169 * s2 - 0.1011 * s3);
    // Nought at t = 0 and its full amplitude a few seconds later, because a warp
    // that is merely constant at t = 0 is still a warp: the frame the walker
    // arrives on has to be the photograph, not the photograph deformed.
    return offset * (${glsl(CHURN_AMP)} * uRise);
  }

  // Where this fragment reads, once the churn has moved it.
  //
  // A wisp has no body to churn — and that is not a saving, it is what makes
  // the warp safe. The silhouette this fragment belongs to was cut round the
  // cloud in cells a degree and a half across, and a cell was dropped when
  // nothing in it carried more than three parts in two hundred and fifty five.
  // Warping at full amplitude everywhere would pull material across that
  // boundary, and material cut off at a cell boundary is a straight edge in the
  // sky. Held to nothing exactly where the coverage is, the boundary has
  // nothing to carry across it, and the body of the cloud still moves.
  //
  // Clamped inside the tile's own rectangle: the atlas holds its tiles a few
  // texels apart, and a warp of three per cent of a mass is nineteen, which
  // would read a neighbour.
  vec2 warpedUv(float cover) {
    vec2 warp = churn(vTile.xy, vFrame.z) * smoothstep(0.0, 0.06, cover);
    vec2 origin = vUv - vTile.xy * vTile.zw;
    vec2 edge = vec2(${glsl(edgeU)}, ${glsl(edgeV)});
    return clamp(vUv + warp * vTile.zw, origin + edge, origin + vTile.zw - edge);
  }
`;

// The photographic field: a piece of the reference's own picture, relit by the
// ratio of two shadings of the surface its coverage implies.
//
// This material is on its way out. It exists because the weather used to be
// cut from target.png, and it goes the day the generated pieces are packed —
// see the note over createClouds. Nothing new should be taught to it.
const photographicFragment = (atlas, cover) => /* glsl */`
  ${cloudCommon(0.5 / atlas.width, 0.5 / atlas.height)}
  uniform sampler2D tClouds;
${cover ? '  uniform sampler2D tCover;' : ''}
  uniform float uLevel;
  uniform vec3 uShade;

  varying vec3 vSun;
  varying vec3 vSource;
  varying vec3 vGrad;
  varying float vLevel;

  // WHERE THE COVERAGE COMES FROM, and it is a property of the delivery.
  //
  // It used to be the fourth channel of the colour atlas, and a block codec
  // cannot hold a block that is part cloud and part nothing: the silhouette came
  // back as a staircase of squares and the clear sky inside every window came
  // back carrying a few parts in two hundred and fifty five of false cloud. A
  // delivery that ships the coverage on its own gets it exact; one that does not
  // reads the fourth channel exactly as before, so nothing here needs the two
  // deliveries to agree about anything but the geometry of the tile.
  float coverAt(vec2 uv) {
    return ${cover ? 'texture2D(tCover, uv).r' : 'texture2D(tClouds, uv).a'};
  }

  // What a piece of cloud is lit to, from the surface its own coverage implies.
  //
  // The same three terms the bake divided by, and it is the same code because it
  // has to be: ambient, a lambert term, and a forward scattering term with a rim
  // in it, which between them are why a cumulus seen against the sun has a
  // bright edge and a grey belly.
  float shadeOf(vec2 gradient, float cover, vec3 sun) {
    vec3 normal = normalize(vec3(-gradient, 1.0));
    float lambert = max(0.0, dot(normal, sun));
    float forward = max(0.0, sun.z);
    float rim = 1.0 - min(1.0, cover);
    return uShade.x + uShade.y * lambert
      + uShade.z * forward * forward * (0.35 + rim * rim);
  }

  void main() {
    float cover = coverAt(vUv);
    // Most of a cell is sky. Nothing here writes depth, so the early test
    // that rejects a sprite behind a monolith survives this.
    if (cover <= 0.0) discard;

    vec2 uv = warpedUv(cover);
    vec4 texel = texture2D(tClouds, uv);
    cover = coverAt(uv);

    // THE GAIN IS THE SKY THIS CORNER STANDS IN FRONT OF, not the sky the
    // middle of the piece stands in front of.
    //
    // A plate is brought into this world by its own sky — the ratio of the dome
    // here to the background it was photographed against — and the packing had
    // one sky per piece to do it with, read at the height the composition
    // stands that piece at. This dome falls by a factor of three between two
    // degrees of elevation and fifteen, and a bank is twenty degrees tall: its
    // base hangs in a sky twice the radiance of the one its gain was worked out
    // for, so it arrives that much too dark against it and its crown that much
    // too bright. Measured on the delivery before this one, the base of the
    // hero came back at 163 display levels where its own material asks for 172,
    // and in Weber contrast — which is what the eye reads and what the campaign
    // is judged on — a factor of one and nine tenths of it was missing.
    //
    // So the gain is finished here, per CORNER, from a table of the dome's own
    // level against height that the packing writes into the manifest. It costs
    // one attribute, one varying and one multiply, no read and no arithmetic
    // per fragment, and a piece standing at several heights gets the right
    // answer at each of them without a second copy in the atlas.
    // AND THE COLOUR IS HELD TO ITS OWN COVERAGE, which is a restatement of what
    // the atlas is and not a threshold.
    //
    // Every texel of the colour is the cloud's material multiplied by the
    // coverage in the same texel, over one scale for the whole atlas, so it
    // cannot stand above that coverage: the packing writes nothing else. The
    // block codec the colour travels through does not know that. Where a block
    // is part cloud and part nothing it lifts the empty part, and because the
    // frame blends premultiplied — destination times one minus alpha, plus the
    // source — a lifted colour beside a coverage of nearly nought ADDS light
    // over open sky. With the coverage now exact and in its own file the
    // silhouette no longer follows it, so what was a staircase became squares of
    // pale wash inside the silhouette instead: visible over the zenith, where
    // the veils carry a hundredth of coverage across whole degrees of sky.
    //
    // One min, no read, no branch. It can only ever remove light the packing did
    // not put there.
    vec3 colour = min(texel.rgb, vec3(cover)) * uLevel * vLevel;

    // A piece that stands where it was cut from is multiplied by nothing: its
    // two suns are the same vector and the ratio below is exactly one, so the
    // four taps it would cost are not taken at all.
    if (vGrad.z > 0.0) {
      float left = coverAt(uv - vec2(vGrad.x, 0.0));
      float right = coverAt(uv + vec2(vGrad.x, 0.0));
      float up = coverAt(uv - vec2(0.0, vGrad.y));
      float down = coverAt(uv + vec2(0.0, vGrad.y));
      // Stated per degree of sky by the scale the bake wrote, so the surface a
      // tile implies does not depend on how finely it was written.
      vec2 gradient = vec2(right - left, up - down) * vGrad.z;
      // Where it stands, turned by the roll and the mirror the geometry was
      // laid with; where it came from, as it was cut. The sun it is lit by is
      // the first frame's, the sun it was lit by is the second's.
      vec2 turned = vec2(gradient.x * vFrame.z, gradient.y);
      turned = vec2(turned.x * vFrame.x - turned.y * vFrame.y,
                    turned.x * vFrame.y + turned.y * vFrame.x);
      // The ratio, not the two shadings: whatever level of detail this gradient
      // was read at, both are read at it, and it divides out.
      colour *= shadeOf(turned, cover, vSun)
        / max(0.05, shadeOf(gradient, cover, vSource));
    }

    // Triangular noise of one step of the stored picture. The atlas holds its
    // colour through the sRGB transfer function, so a step of one least
    // significant bit up there is the slope of that function at the value read,
    // which over the range a cloud occupies is within a tenth of two roots of
    // the radiance over two hundred and fifty five.
    vec2 draws = cloudNoisePair(gl_FragCoord.xy);
    vec3 quantum = sqrt(max(colour * uLevel, 0.0)) * (2.0 / 255.0);
    // What the air in front of this piece has left of it, on the coverage and
    // on the colour alike because the colour is premultiplied by it. A plate is
    // a photograph of cloud tens of kilometres off and carries whatever haze
    // stood in front of it that day, so it does not owe the whole of this
    // world's air — how much it does owe is the manifest's, measured, and is
    // the one number that separates this material from the generated one here.
    float keep = 1.0 - uAerialOwed * aerialVeil(vDir);
    // Premultiplied: the colour is already scaled by the coverage it carries,
    // which is what lets a filtered edge stay the colour it was.
    gl_FragColor = vec4(max(colour + (draws.x - draws.y) * quantum * cover, 0.0) * keep,
      cover * keep);
  }
`;

// The generated field: a piece that carries its own light and is told where the
// light is.
//
// ONE READ FOR THE COVERAGE BEFORE THE WARP, THEN ONE PER TEXTURE AT THE WARPED
// POINT. An atlas of two textures — every rank up to seven — costs three, and
// the third is the only one this pays over a mass of the photographic field; an
// atlas of three costs four. A library piece of the photographic field takes
// six, because a cut-out standing away from its own bearing has to have its
// shading tilted by four taps of its coverage; this has no bearing of its own
// to stand away from, so four is still the cheaper end of what the sky already
// pays.
//
// The first read cannot be folded into the others and the count cannot be
// beaten by re-packing: coverage is wanted at TWO points — unwarped, to hold
// the churn to nothing where the silhouette was cut, and warped, because that
// is the alpha the frame blends — so whichever texture holds it is read twice,
// and every other texture is read once. Which is why rank seven is worth
// defending: seven maps and a coverage are exactly eight channels.
const relitFragment = (atlas, layout) => /* glsl */`
  ${cloudCommon(0.5 / atlas.width, 0.5 / atlas.height)}
${layout.map((maps, t) => `  uniform sampler2D tCloud${textureLetter(t)};      `
    + `// ${maps.map((r) => `m${r}`).join(', ')}${t === 0 ? ', coverage' : ''}`).join('\n')}

${layout.map((maps, t) => `  varying vec4 vGain${textureLetter(t)};            `
    + `// ${maps.length > 1 ? 'gains' : 'gain'} for `
    + `${maps.length > 1 ? `m${maps[0]}..m${maps[maps.length - 1]}` : `m${maps[0]}`}`
    + `${t === 0 ? ', and the offset in w' : ''}`).join('\n')}

  ${relightGlsl(layout)}

  void main() {
    float cover = texture2D(tCloudA, vUv).a;
    // Most of a cell is sky. Nothing here writes depth, so the early test
    // that rejects a sprite behind a monolith survives this.
    if (cover <= 0.0) discard;

    vec2 uv = warpedUv(cover);
${layout.map((_, t) => `    vec4 ${'abcdefgh'[t]} = texture2D(tCloud${textureLetter(t)}, uv);`).join('\n')}
    cover = a.a;

    vec3 colour = cloudRadiance(${[
    'a.rgb',
    ...layout.slice(1).map((_, t) => 'abcdefgh'[t + 1]),
    ...layout.map((_, t) => `vGain${textureLetter(t)}`),
  ].join(', ')});

    // Triangular noise of one step of the display, in the display's own units:
    // the frame is encoded through the sRGB transfer after the tone curve, so a
    // least significant bit up there is the slope of that function at the value
    // read, which over the range a cloud occupies is within a tenth of two
    // roots of the radiance over two hundred and fifty five. Same figure as the
    // dome's, because this is blended over the dome and the pair was chosen
    // together — but taken on RADIANCE here rather than on a stored picture,
    // because what this material writes is radiance and there is no picture.
    vec2 draws = cloudNoisePair(gl_FragCoord.xy);
    vec3 quantum = sqrt(max(colour, 0.0)) * (2.0 / 255.0);
    // What the air has left of this piece. Taken on the coverage rather than on
    // the colour, which is the same frame exactly and costs no sky. A generated
    // piece is lit from a model and carries no haze of its own, so it owes the
    // whole of it — which is what uAerialBaked is set to for this atlas.
    float alpha = cover * (1.0 - uAerialOwed * aerialVeil(vDir));
    // Premultiplied last: what came out of the reconstruction is the radiance of
    // the cloud's own body, and the coverage is how much of this fragment is
    // body at all. Multiplying after the dither is what lets a filtered edge
    // stay the colour it was.
    gl_FragColor = vec4(max(colour + (draws.x - draws.y) * quantum, 0.0) * alpha, alpha);
  }
`;

/**
 * The dome's own level against height, as the packing measured it.
 *
 * A photographic piece is written into the atlas at the gain that puts its
 * cloud the same distance over this world's sky as it stood over its own, and
 * that gain is one number for a piece which is twenty degrees tall in a sky
 * that changes by a factor of three across those twenty degrees. The table is
 * what lets the runtime finish the job per corner. It is the PACKING's to
 * write, because the packing is where the gain was taken; a manifest without
 * one gets a flat table and behaves exactly as before.
 *
 * @param {object} manifest  assets-src/clouds/clouds.json
 * @returns {(deg: number) => number} the dome's luminance at a height
 */
function skyProfileOf(manifest) {
  const p = manifest.sampling && manifest.sampling.skyProfile;
  if (!p || !p.values || p.values.length < 2) return () => 1;
  const { from, step, values } = p;
  return (deg) => {
    const x = Math.min(values.length - 1, Math.max(0, (deg - from) / step));
    const i = Math.min(values.length - 2, Math.floor(x));
    return values[i] + (values[i + 1] - values[i]) * (x - i);
  };
}

/** East, up and the direction itself, for a bearing and a height. */
function basisOf(azimuthDeg, elevationDeg) {
  const e = elevationDeg * DEG;
  const a = azimuthDeg * DEG;
  const forward = new Vector3(
    Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a),
  );
  const right = new Vector3(Math.cos(a), 0, Math.sin(a));
  const up = new Vector3().crossVectors(right, forward).normalize();
  return { forward, right, up };
}

/** The sun in the local frame of a bearing and a height. */
function sunInLocalFrame(azimuthDeg, elevationDeg, sun) {
  const { forward, right, up } = basisOf(azimuthDeg, elevationDeg);
  return [sun.dot(right), sun.dot(up), sun.dot(forward)];
}

/**
 * The "no plane crosses a prism" invariant, checked instead of trusted.
 *
 * A sprite facing the eye is a plane tangent to the sphere of its own distance,
 * so its points lie between that distance and the distance of its furthest
 * corner. A box at horizontal distance d with footprint half diagonal g occupies
 * the radial shell [d − g, d + g] over the bearings it subtends. Where a
 * sprite's shell meets a box's shell and their bearings also meet, the plane
 * cuts the box, and the frame gets a ruled line along the intersection.
 *
 * With the field at nine hundred metres and every box in this world inside
 * twenty five, this cannot fire, and that is the point of writing it: it fires
 * the day somebody moves the field nearer, or stands something far away, and it
 * fires at startup rather than in a screenshot three sessions later.
 *
 * @returns {string[]} one complaint per crossing, empty when the field is clear
 */
export function checkPrismClearance(placements, blockers) {
  const complaints = [];
  for (const sprite of placements) {
    const near = sprite.distance;
    const far = sprite.distance * Math.sqrt(1 + sprite.halfU ** 2 + sprite.halfV ** 2);
    const spriteHalf = Math.atan(sprite.halfU) / DEG;
    for (const box of blockers) {
      const d = Math.hypot(box.x - ORIGIN.x, box.z - ORIGIN.z);
      const g = Math.hypot(box.halfWidth, box.halfDepth);
      if (d <= g) continue;
      const boxHalf = Math.asin(Math.min(1, g / d)) / DEG;
      const bearing = Math.atan2(box.x - ORIGIN.x, -(box.z - ORIGIN.z)) / DEG;
      let delta = bearing - sprite.azimuth;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      if (Math.abs(delta) > boxHalf + spriteHalf) continue;
      const lo = d - g - PRISM_CLEARANCE;
      const hi = d + g + PRISM_CLEARANCE;
      if (far > lo && near < hi) {
        complaints.push(`${sprite.id} at ${sprite.azimuth.toFixed(1)} deg spans `
          + `${near.toFixed(0)}-${far.toFixed(0)} m and crosses a box at ${d.toFixed(0)} m `
          + `(shell ${lo.toFixed(0)}-${hi.toFixed(0)} m): move it in front or behind`);
      }
    }
  }
  return complaints;
}

/**
 * Where every sprite stands, back to front.
 *
 * A mass keeps the bearing and the height it was cut from — that is what makes
 * the reference pose the photograph — and carries no relighting, because the sun
 * it would be relit to is the sun it already has.
 *
 * The rules are the composition's, not the atlas's, so this is the same
 * function for the photographic field and the generated one: same kinds, same
 * excursion budgets, same order, same distance. A generated composition that
 * wants different rules is a different composition, not a second planner.
 *
 * @param {object} composition tiles, placements — the shape of assets-src/clouds/clouds.json
 */
function planField(composition) {
  const placements = [];
  for (const tile of composition.tiles) {
    if (!STANDING.has(tile.kind)) continue;
    // A MASS MAY BE SIZED, and it could not be until the weather stopped being a
    // photograph. A mass used to be a rectangle of the reference's own picture
    // standing at the bearing it was cut from, and at any size but its own it
    // would have been that picture stretched — so the one size it was allowed
    // was one, and the composition rule that followed forbade a SCALED piece
    // from reaching into the reference's framing, because inside that framing
    // every pixel was measured and a resized piece over it was invention laid
    // on measurement. Both halves of that argument are about photographic
    // pixels, and there are none left in there: the weather inside the framing
    // is generated, like the weather everywhere else. What survived the argument
    // was a floor on the grain — the smallest body any piece of the roster makes
    // at its own size is eleven degrees across, against a median of one and
    // eight tenths in the reference — so the arrival frame could hold three
    // lumps where the photograph holds eighteen bodies. Absent scale still means
    // one, so a composition that states none is drawn exactly as before.
    const scale = tile.scale === undefined ? 1 : tile.scale;
    placements.push({
      id: tile.id,
      tile,
      azimuth: tile.azimuth,
      elevation: tile.elevation,
      halfU: tile.halfU * scale,
      halfV: tile.halfV * scale,
      distance: DISTANCE,
      scale,
      roll: 0,
      flip: 1,
      // Where it was cut from is where it stands, so nothing is relit.
      relit: false,
      arc: ARC_MASS_DEG,
    });
  }
  // And the library, across the bearings the photograph never showed. Every one
  // of these is somewhere else than where it was cut, so every one is relit,
  // rolled and half of them mirrored — which is what stops the far sky reading
  // as a shelf of copies of the sector behind the walker.
  const byId = new Map(composition.tiles.map((t) => [t.id, t]));
  for (const stand of composition.placements || []) {
    const tile = byId.get(stand.tile);
    if (!tile) continue;
    placements.push({
      id: stand.id,
      tile,
      azimuth: stand.azimuth,
      elevation: stand.elevation,
      halfU: tile.halfU * stand.scale,
      halfV: tile.halfV * stand.scale,
      distance: stand.distance || DISTANCE,
      scale: stand.scale,
      roll: stand.roll,
      flip: stand.flip,
      relit: true,
      // A piece the bake laid behind a monolith carries its own excursion, and
      // it is nought: its whole licence to stand inside the sector the
      // photograph owns is that the block hides it, and a drift is the one
      // thing that would take it out from behind the block. The bake states the
      // number and checks it; this only obeys it.
      arc: stand.arc === undefined ? ARC_LIBRARY_DEG : stand.arc,
    });
  }
  // Far first: a piece low in the sky is further away than a piece high in it,
  // so the high one goes over the top. Settled here rather than per frame,
  // because a composition does not change its mind.
  placements.sort((a, b) => a.elevation - b.elevation);
  return placements;
}

/**
 * Which weather this run is drawing, and there is never more than one answer.
 *
 * THE FLAG IS THE ASSET. The generated pieces are a bake of several hours and
 * they arrive all at once; until they do, the photographic field is what the
 * world has. So the choice is not a setting anybody can get wrong — it is
 * whether the atlas the gateway was asked for came back. A manifest without the
 * generated entries delivers nothing, `relit` is null, and the photographic
 * path runs exactly as it did.
 *
 * This was written as a MIGRATION and not an option, and the migration went the
 * other way: the plates reached a scale and a material the generator could not,
 * so what ships is the plate field and the generated entries have been taken
 * out of the delivery. This function is therefore reached with null on every
 * run and returns at its first line. It is kept because the bake that feeds it
 * is kept, and because the day the sky has to be lit from a direction no
 * photograph had — which is the whole reason the weather was regenerated once
 * already — this is the path that answers it.
 *
 * @param {{manifest: object, textures: Texture[]}|null} relit
 */
function relitSetup(relit) {
  if (!relit || !relit.manifest || !relit.textures) return null;
  const { manifest } = relit;
  const composition = manifest.composition;
  if (!composition || !composition.tiles) {
    console.warn('[clouds] the generated atlas carries no composition: nothing knows where '
      + 'its pieces stand, so the photographic field is drawn instead');
    return null;
  }
  // HOW MANY MAPS THIS ATLAS CARRIES, AND HOW MANY TEXTURES IT TOOK TO CARRY
  // THEM, ARE THE MANIFEST'S TO SAY. The rank is a decision taken at the
  // packing, and the runtime that reads the result has no business holding an
  // opinion about it: it builds the shader the delivered atlas needs. What it
  // does check is that the two halves of that statement agree, because a rank
  // that wants more channels than the textures have is an atlas whose last maps
  // are nowhere, and reading them would be reading somebody else's channel.
  const layout = atlasLayout(manifest.rank);
  const geometry = manifest.atlas.textures;
  if (layout.length !== geometry.length || relit.textures.length !== geometry.length) {
    console.warn(`[clouds] the generated atlas declares rank ${manifest.rank}, which wants `
      + `${layout.length} texture(s), against ${geometry.length} in the manifest and `
      + `${relit.textures.length} delivered: the photographic field is drawn instead`);
    return null;
  }
  // ONE COORDINATE ADDRESSES EVERY ATLAS, and that is a property of the packing
  // rather than a coincidence worth relying on quietly: every texture after the
  // first is the first one's geometry divided by an integer, tiles, gutters and
  // all, so a tile's rectangle in normalised coordinates is the same rectangle
  // in all of them. Checked here, because the day a packing breaks it every
  // piece would read its neighbour's maps and the frame would still draw.
  const [a] = geometry;
  const mismatch = geometry.slice(1).some((b) => Math.abs(a.width / b.width - a.height / b.height) > 1e-9
    || Math.abs(a.width / b.width - a.tile / b.tile) > 1e-9);
  if (mismatch) {
    console.warn('[clouds] the generated atlases are not one geometry at several scales: '
      + 'one texture coordinate cannot address them all, and the photographic field is drawn instead');
    return null;
  }
  // The packing knows where a piece IS in the atlas and what its light does; the
  // composition knows where it STANDS. They are written by different steps
  // because they answer different questions, and they meet here, once, so that
  // everything downstream sees a tile of exactly the shape the photographic
  // field's tiles have.
  const packed = new Map(manifest.tiles.map((t) => [t.name, t]));
  const tiles = [];
  for (const tile of composition.tiles) {
    const p = packed.get(tile.id);
    if (!p) {
      console.warn(`[clouds] the composition stands "${tile.id}", which the atlas does not hold`);
      continue;
    }
    tiles.push({ ...tile, rect: p.rects[0], ranges: p.ranges, curves: p.curves });
  }
  if (!tiles.length) return null;
  return {
    manifest,
    layout,
    composition: { ...composition, tiles },
    arc: arcOf(manifest),
  };
}

/**
 * Builds the cloud field.
 *
 * @param {object} clouds  the photographic sprite atlas, as delivered by the gateway
 * @param {object} cover   the same atlas's coverage, on its own and uncompressed,
 *   when the delivery carries one; without it the colour atlas's fourth channel
 *   is read exactly as before
 * @param {object} relit   the generated atlas: its manifest and the textures it declares
 * @param {Array}  blockers  what the walker cannot walk through, for the check
 * @param {boolean} frozen  development flag: hold the weather at its first frame
 */
export function createClouds({
  clouds, cover = null, relit = null, blockers = [], frozen = false,
}) {
  const generated = PLATE_FIELD ? null : relitSetup(relit);
  if (!clouds && !generated) {
    return {
      meshes: [],
      sprites: 0,
      triangles: 0,
      warnings: [],
      update() {},
      turns: () => 0,
      seconds: () => 0,
      setVisible() {},
      setLayers() {},
    };
  }

  const composition = generated ? generated.composition : CLOUDS;
  const placements = planField(composition);
  const warnings = checkPrismClearance(placements, blockers);
  for (const warning of warnings) console.warn(`[clouds] ${warning}`);

  const vertices = placements.reduce((t, p) => t + p.tile.parts.length * 4, 0);
  const triangles = placements.reduce((t, p) => t + p.tile.parts.length * 2, 0);
  const position = new Float32Array(vertices * 3);
  const uv = new Float32Array(vertices * 2);
  // The photographic field's own: where the piece was photographed from, where
  // it stands now, and how to read a slope off its coverage. A generated piece
  // carries its light instead of being told how to fake it, so it has none.
  const aSun = generated ? null : new Float32Array(vertices * 3);
  const aSource = generated ? null : new Float32Array(vertices * 3);
  const aGrad = generated ? null : new Float32Array(vertices * 3);
  // And what finishes its calibration: the dome at this corner's own height
  // over the dome at the height the packing calibrated the piece against.
  const aLevel = generated ? null : new Float32Array(vertices);
  const skyLevel = generated ? null : skyProfileOf(CLOUDS);
  const calibratedAt = new Map(Object.entries((CLOUDS.sampling && CLOUDS.sampling.gains) || {})
    .map(([id, g]) => [id, g]));
  // And the generated field's own: which sprite this vertex belongs to, which
  // is how it finds the eight numbers this frame's light gave its piece.
  const aPiece = generated ? new Float32Array(vertices) : null;
  const aFrame = new Float32Array(vertices * 3);
  const aLife = new Float32Array(vertices * 3);
  const aTile = new Float32Array(vertices * 4);
  const index = new Uint16Array(triangles * 3);
  // Where each sprite's triangles begin and end in that index, so a measurement
  // can ask for one layer of the sky without rebuilding the field. The whole
  // point of welding is that there is one draw, which is also why hiding a mesh
  // cannot answer what a layer costs.
  const runs = [];

  // WHERE THE SUN COMES FROM, and there is only one answer in this frame.
  //
  // It used to be read out of the cloud manifest, which is a second copy of a
  // number src/core/sky.js already owns — and the two would have to be kept
  // equal by hand for the aureole to sit where the weather says the light is.
  // Now the dome, the aureole, the reflections and this all read one uniform,
  // so a day and night cycle moves the light on the cumulus and the glow in the
  // sky together, or it moves neither.
  //
  // The manifest's own sun is still read, and still matters, but as a different
  // thing: it is the sun each tile was PHOTOGRAPHED under, which is a property
  // of the picture and cannot change. The relighting below is the ratio of the
  // two, so the day the world's sun moves, the ratio is what moves with it.
  const sun = new Vector3().copy(SUN_DIRECTION);
  if (!generated) {
    const baked = new Vector3(...CLOUDS.sun.vector);
    if (baked.angleTo(sun) > SUN_DRIFT_LIMIT) {
      console.warn('[clouds] the atlas was cut under a sun '
        + `${(baked.angleTo(sun) / DEG).toFixed(1)} deg from the one lighting the world: `
        + 'the pieces standing where they were cut carry the wrong light');
    }
  } else {
    // THE ARC IS A ONE PARAMETER FAMILY, and this is what says so out loud.
    //
    // The pieces were baked along a single great circle of sun directions. A
    // direction ON that circle is reconstructed by interpolating between two
    // baked planes, which is the error the bake measured and holds under four
    // display levels. A direction OFF it has no place on the circle at all:
    // projecting one there lights the cloud from the nearest point of a path
    // the sun is not on, and the error is no longer the fit's — it is however
    // much light that many degrees are worth, and nobody measured it because
    // nobody baked it.
    //
    // Measured on the prototype pieces, the world's own sun sits 8.3 degrees
    // off the circle the first ring was cut on, and reconstructing there costs
    // 4.9 to 5.6 display levels against a net of four. That is a property of
    // the RING, not of this code, and no arithmetic here can undo it: the ring
    // has to contain the sun the world is lit by. Hence a warning and not a
    // silent projection.
    const off = Math.abs(generated.arc.offPlaneOf(sun));
    if (off > ARC_PLANE_LIMIT) {
      console.warn(`[clouds] the world's sun is ${off.toFixed(1)} deg off the plane of the arc `
        + 'the pieces were baked along: it is being projected onto the nearest point of that '
        + 'arc, and the light on every piece is the light of a direction that far away');
    }
  }
  const atlas = generated ? generated.manifest.atlas.textures[0] : CLOUDS.atlas;
  const { width: atlasWidth, height: atlasHeight } = atlas;
  let v = 0;
  let f = 0;
  let n = 0;
  for (const sprite of placements) {
    const { tile } = sprite;
    runs.push({
      kind: sprite.relit ? 'library' : tile.kind, id: sprite.id, tile: tile.id, start: f * 3,
    });
    const { forward, right, up } = basisOf(sprite.azimuth, sprite.elevation);
    // Its own place in the churn, so that no two sprites deform in step. Drawn
    // from the order they are laid in rather than from a generator, because a
    // composition that changes between two runs is a composition nobody can
    // compare against a photograph.
    const phaseU = (n * PHASE_STEP[0]) % 1;
    const phaseV = (n * PHASE_STEP[1]) % 1;
    const arc = sprite.arc * DEG;
    const tileU = tile.rect.width / atlasWidth;
    const tileV = tile.rect.height / atlasHeight;
    const piece = n;
    n++;
    // The photographic field's own arithmetic: the sun a piece stands under,
    // the sun it was photographed under, and the slope the bake read its normal
    // with, per degree of sky where the sprite now stands. `slope` is negative
    // where nothing moves, which is how that shader knows not to take the four
    // taps. None of it exists for a generated piece.
    const target = generated || !sprite.relit
      ? tile.sunSource : sunInLocalFrame(sprite.azimuth, sprite.elevation, sun);
    const texelU = 1 / atlasWidth;
    const texelV = 1 / atlasHeight;
    // WHY A PLATE IS NOT RELIT, and it is a measurement and not a preference.
    //
    // The ratio below tilts a piece's shading by dividing two evaluations of the
    // same model: one under the sun the piece now stands beneath, one under the
    // sun it was photographed under. The surface both are evaluated on is
    // invented from the piece's OWN COVERAGE — a heightfield whose slope at a
    // silhouette is not a cloud's slope but the edge of a cut-out, and which
    // this roster's sampling rate turns into gradients of twenty to fifty.
    //
    // Measured on the delivered sky, at six bearings round the compass and with
    // nothing else changed: the mean effect of the
    // ratio on the cloud is between 0.988 and 0.998 — one part in a hundred —
    // while it moves between 3 and 20 per cent of the cloud's pixels by six
    // display levels or more, with peaks of 39 to 50. It is not lighting the
    // weather from anywhere; it is carving ridges and hollows along the gradient
    // of the matte. And because the four taps follow the sampler's own level of
    // detail, that carving CHANGES AS THE EYE MOVES: standing still at sixty
    // frames a second it is the whole of the field's flicker (0.33 per cent of
    // channels moving two levels or more per frame with it, 0.00 without), and
    // turning at twelve degrees a second it is a fifth of everything the motion
    // cannot explain.
    //
    // The reason it cannot work is prior to the measurement: a plate's light is
    // IN ITS PIXELS. A photograph of a backlit bank records where that bank's
    // own towers stood against that day's sun, and no ratio of two shadings of a
    // matte can move it. The generated pieces carry a fitted basis and are relit
    // properly, by cloudRadiance in the other material; this path was built for
    // rectangles cut out of the reference's own frame and is the last thing left
    // of them. Turning it off also gives the fragment back four texture reads.
    const slope = !generated && !PLATE_FIELD && sprite.relit
      ? CLOUDS.shade.normalSlope / (2 * tile.degPerTexel * (sprite.scale || 1)) : -1;
    const roll = (sprite.roll || 0) * DEG;
    const cos = Math.cos(roll);
    const sin = Math.sin(roll);
    // THE CALIBRATION IS FINISHED PER PLACEMENT, and only per placement.
    //
    // A plate is written into the atlas at the gain that puts its cloud the
    // same distance over this world's sky as it stood over its own, and the sky
    // it is compared against is the one at the height the composition stands it
    // at. The atlas holds ONE copy of a piece and the composition stands
    // several of them: the packing has to pick one height, and it picks the
    // mean, which is right for neither. Standing the same bank at eight degrees
    // and at sixteen is standing it in two skies a factor of two apart, and
    // measured on this delivery nine of the fifteen pieces stand at two heights
    // — frammenti-4 at sixteen and at eight, where the dome is 0.116 against
    // 0.241. So the ratio of the two skies is undone here, per sprite, from a
    // table the packing writes: one attribute, one multiply, no read.
    //
    // WHAT IS DELIBERATELY NOT DONE IS THE SAME THING PER CORNER. A bank is
    // twenty degrees tall and this dome falls by a factor of three across
    // twenty degrees, so the argument above says the base of a bank is too dark
    // against its own sky and its crown too bright. Carrying it to the corners
    // was built and shot twice, and both times the frame got worse: against the
    // dome itself the base's Weber contrast went to 0.46 where the reference
    // reads 0.22, the contrast at ten and at twenty two degrees FELL, and four
    // bodies welded into one carrying 97 per cent of the cloud; against the
    // dome with the airlight taken out, which is the version that survives the
    // algebra in tools/clouds/ingest/pack.mjs, the coverage fell from 21 per
    // cent to 13. The reference itself says why the first cannot be right: it
    // reads 0.22 at two degrees of elevation and 0.58 at twenty two, so a
    // cloud's contrast against the sky RISES with height, while a gain tied to
    // the dome makes it fall. Per placement is a mistake corrected; per corner
    // is a law asserted, and the law is not this one.
    //
    // AND THE HEIGHT OF A PLACEMENT IS WHERE ITS CLOUD IS. A window is cut with
    // room to spare round the body in it, so the middle of the window and the
    // middle of the cloud are not the same height — up to three degrees apart
    // on this roster, which on this dome is a fifth of the level. The packing
    // measures where a piece's own coverage sits inside its window and both
    // sides of this ratio are taken there.
    const calibration = calibratedAt.get(tile.id);
    const centroidT = calibration && calibration.centroidT !== undefined
      ? calibration.centroidT : 0;
    const standsAt = sprite.elevation
      + Math.atan(centroidT * tile.halfV * (sprite.scale || 1)) / DEG;
    const calibrationHeight = calibration ? calibration.at : standsAt;
    const spriteLevel = generated ? 1 : skyLevel(standsAt) / skyLevel(calibrationHeight);
    // A MIRROR TURNS A TRIANGLE OVER, and this material is drawn front face
    // only. Emitting the four corners in one fixed order and negating s for a
    // mirrored piece reverses the winding of both its triangles, so the whole
    // sprite faces away from the eye and the rasteriser drops it — silently,
    // because a sprite that draws nothing looks exactly like a sprite the
    // composition never asked for. Every quad here faces the walker by
    // construction, so the cull has nothing else to reject; walking the corners
    // the other way round when the piece is mirrored gives it back its facing
    // and keeps the winding meaningful.
    for (const [s0, t0, s1, t1] of tile.parts) {
      const first = v;
      const corners = [[s0, t0], [s1, t0], [s1, t1], [s0, t1]];
      if (sprite.flip < 0) corners.reverse();
      for (const [su, t] of corners) {
        // The roll turns the piece in its own tangent plane, and the mirror
        // turns it over. Both are geometry — the texture is read as it stands
        // and the fragment turns its gradient back by the same amount, because
        // a normal read in a rolled frame is a normal lit from the wrong side.
        const s = su * sprite.flip;
        const point = forward.clone()
          .addScaledVector(right, (s * cos - t * sin) * sprite.halfU)
          .addScaledVector(up, (s * sin + t * cos) * sprite.halfV)
          .multiplyScalar(sprite.distance)
          .add(ORIGIN);
        position[v * 3] = point.x;
        position[v * 3 + 1] = point.y;
        position[v * 3 + 2] = point.z;
        uv[v * 2] = (tile.rect.x + (su + 1) / 2 * tile.rect.width) / atlasWidth;
        uv[v * 2 + 1] = (tile.rect.y + (1 - t) / 2 * tile.rect.height) / atlasHeight;
        if (generated) {
          aPiece[v] = piece;
        } else {
          for (let k = 0; k < 3; k++) {
            aSun[v * 3 + k] = target[k];
            aSource[v * 3 + k] = tile.sunSource[k];
          }
          aGrad[v * 3] = texelU;
          aGrad[v * 3 + 1] = texelV;
          aGrad[v * 3 + 2] = slope;
          aLevel[v] = spriteLevel;
        }
        aFrame[v * 3] = cos;
        aFrame[v * 3 + 1] = sin;
        aFrame[v * 3 + 2] = sprite.flip;
        aLife[v * 3] = arc;
        aLife[v * 3 + 1] = phaseU;
        aLife[v * 3 + 2] = phaseV;
        // Where this corner sits in the tile's own square, and how large that
        // square is in the atlas: between them the fragment can warp inside the
        // tile and stay inside it.
        aTile[v * 4] = (su + 1) / 2;
        aTile[v * 4 + 1] = (1 - t) / 2;
        aTile[v * 4 + 2] = tileU;
        aTile[v * 4 + 3] = tileV;
        v++;
      }
      index[f * 3] = first;
      index[f * 3 + 1] = first + 1;
      index[f * 3 + 2] = first + 2;
      index[f * 3 + 3] = first;
      index[f * 3 + 4] = first + 2;
      index[f * 3 + 5] = first + 3;
      f += 2;
    }
    runs[runs.length - 1].count = f * 3 - runs[runs.length - 1].start;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  if (generated) {
    geometry.setAttribute('aPiece', new BufferAttribute(aPiece, 1));
  } else {
    geometry.setAttribute('aSun', new BufferAttribute(aSun, 3));
    geometry.setAttribute('aSource', new BufferAttribute(aSource, 3));
    geometry.setAttribute('aGrad', new BufferAttribute(aGrad, 3));
    geometry.setAttribute('aLevel', new BufferAttribute(aLevel, 1));
  }
  geometry.setAttribute('aFrame', new BufferAttribute(aFrame, 3));
  geometry.setAttribute('aLife', new BufferAttribute(aLife, 3));
  geometry.setAttribute('aTile', new BufferAttribute(aTile, 4));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingSphere();

  // What a frame's light gives each sprite: three gains and the offset in the
  // first vector, then four gains for every texture after the first — the same
  // four things in the same order as the channels they multiply. Uploaded as
  // uniform arrays and read in the vertex shader, because that is a couple of
  // hundred floats a frame however many triangles the field has, where a
  // per-vertex attribute would be the same numbers copied onto every corner and
  // re-uploaded every time the sun moved a hair.
  const gains = generated
    ? generated.layout.map(() => new Float32Array(placements.length * 4)) : null;

  const material = new ShaderMaterial({
    uniforms: generated ? {
      ...Object.fromEntries(generated.layout.map((_, t) => [`tCloud${textureLetter(t)}`,
        { value: relit.textures[t] }])),
      ...Object.fromEntries(generated.layout.map((_, t) => [`uGain${textureLetter(t)}`,
        { value: gains[t] }])),
      uAerial: { value: new Vector4(...AERIAL) },
      // A generated piece is lit from a model and has no haze of its own: it
      // owes the whole of this world's air.
      uAerialOwed: { value: 1 },
      uExposure: { value: generated.manifest.tone.exposure },
      uChromaBand: { value: new Vector2(...generated.manifest.chromaticity.band) },
      uChromaR: { value: generated.manifest.chromaticity.red.slice() },
      uChromaB: { value: generated.manifest.chromaticity.blue.slice() },
      uTime: { value: 0 },
      uRise: { value: 0 },
    } : {
      tClouds: { value: clouds },
      ...(cover ? { tCover: { value: cover } } : {}),
      uLevel: { value: CLOUDS.atlas.levelScale },
      uAerial: { value: new Vector4(...AERIAL) },
      // And what a PHOTOGRAPH owes, which is not the whole of it: the plate
      // already carries the haze that stood between the camera and the bank.
      // The manifest states how much, so the day a source with different air in
      // it is ingested the number moves with the delivery and not with a
      // constant in here.
      uAerialOwed: { value: 1 - (CLOUDS.aerialBaked === undefined ? 1 : CLOUDS.aerialBaked) },
      uShade: {
        value: new Vector3(
          CLOUDS.shade.ambient, CLOUDS.shade.diffuse, CLOUDS.shade.forward,
        ),
      },
      uTime: { value: 0 },
      uRise: { value: 0 },
    },
    vertexShader: cloudVertex(generated ? {
      pieces: placements.length,
      letters: generated.layout.map((_, t) => textureLetter(t)),
    } : null),
    fragmentShader: generated
      ? relitFragment(atlas, generated.layout) : photographicFragment(atlas, cover),
    transparent: true,
    // The atlas holds colour already scaled by the coverage it carries, which is
    // what keeps a filtered edge the colour it was instead of dragging it
    // towards black.
    premultipliedAlpha: true,
    // Tested against the world and writing nothing of its own. The test is what
    // takes the field's cost down by the share of the frame the world already
    // covers, which at the reference framing is well over half of it; the write
    // would only cost the sprites behind this one a test they cannot fail, and
    // would make the order they are drawn in matter twice.
    depthTest: true,
    depthWrite: false,
    // The air belongs to the ground. These are kilometres away and already
    // carry, in the photograph they were cut from, whatever haze there was.
    fog: false,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'clouds';
  // Ahead of everything else that blends, so the water and the open panels are
  // laid over the sky the walker is actually looking at.
  mesh.renderOrder = -1;
  // The field surrounds the walker: a bounding sphere test can only ever answer
  // yes, and answering it is work.
  mesh.frustumCulled = false;

  // The clock the weather lives on starts at the first frame the field is drawn
  // in, not at the page: the walker's sky is the reference's composition on the
  // frame they arrive on, whatever the line took to deliver the atlas.
  let origin = null;
  let seconds = 0;

  // Where the light was when the coefficients were last worked out.
  //
  // The sun is one direction for the whole world, and every sprite reads the
  // same point of the arc: what differs between two pieces is the curve each
  // one was fitted with, not where on it the light is. So this is a couple of
  // dozen Catmull-Roms when the light MOVES, and nothing at all on the frames
  // it does not — which is all of them until a cycle or a monolith moves it.
  let lastParam = NaN;
  function relight() {
    const t = generated.arc.paramOf(SUN_DIRECTION);
    if (t === lastParam) return;
    lastParam = t;
    const byTile = new Map();
    for (let i = 0; i < placements.length; i++) {
      const { tile } = placements[i];
      if (!byTile.has(tile.id)) byTile.set(tile.id, coeffsFor(tile, generated.arc.ts, t));
      const { offset, gain } = byTile.get(tile.id);
      // Laid out the way the atlas is: whatever the first texture does not
      // carry goes four at a time into the ones after it, and a channel with no
      // map behind it gets a gain of nought rather than a stale number.
      for (let t = 0; t < generated.layout.length; t++) {
        for (let k = 0; k < 4; k++) {
          gains[t][i * 4 + k] = generated.layout[t][k] === undefined
            ? 0 : gain[generated.layout[t][k]];
        }
      }
      gains[0][i * 4 + 3] = offset;
    }
  }
  if (generated) relight();

  return {
    meshes: [mesh],
    sprites: placements.length,
    triangles,
    warnings,

    /**
     * Moves the weather on.
     *
     * @param {number} elapsed seconds since the page began drawing
     */
    update(elapsed) {
      if (origin === null) origin = elapsed;
      seconds = frozen ? 0 : Math.max(0, elapsed - origin);
      material.uniforms.uTime.value = seconds;
      material.uniforms.uRise.value = 1 - Math.exp(-seconds / CHURN_RISE);
      // The light can move between two frames — that is the whole point of a
      // piece that carries its own — so this is asked every frame and answers
      // in a comparison when the answer has not changed.
      if (generated) relight();
    },

    /**
     * How far the whole field has turned, in turns of the compass.
     *
     * What the water is handed, because the drift is a rotation about the
     * vertical and a rotation about the vertical is a shift along the first
     * axis of an equirect. It is the masses' own excursion: they are what the
     * reference sector reflects, and the library's larger budget only parts
     * from it after the masses have all but saturated.
     */
    turns() {
      const arc = ARC_MASS_DEG;
      const x = Math.min(12, DRIFT_RATE_DEG * seconds / arc);
      return arc * Math.tanh(x) / 360;
    },

    /** Development handle: what the weather's own clock reads, in seconds. */
    seconds() { return seconds; },

    /** Development handle: the field alone, so its cost can be measured. */
    setVisible(visible) { mesh.visible = visible; },

    /**
     * Development handle: the four numbers of the air in front of the weather.
     *
     * They are a FIT — against the reference's own fall of contrast with height
     * — and a fit is refitted by looking, at several bearings, at the sky it
     * makes. Reloading the page between two candidates loses the pose and the
     * weather's clock with it, so the pair cannot be compared; this changes them
     * in place. It is also the hook a day and night cycle needs: the haze of a
     * dusk is not the haze of a noon.
     */
    setAerial(baseline, perPath, sineFloor, ceiling) {
      material.uniforms.uAerial.value.set(baseline, perPath, sineFloor, ceiling);
      return material.uniforms.uAerial.value.toArray();
    },

    /**
     * Development handle: how much of that air THIS delivery still owes.
     *
     * The share a plate already carries cannot be read off the plate — a matte
     * that closes its cores closes them by topology, so what a core falls short
     * of one by says nothing — so the number is fitted against the reference's
     * own fall of contrast with height, and a fit is refitted by looking. Same
     * reason setAerial exists: reloading between two candidates loses the pose.
     */
    setAerialOwed(owed) {
      material.uniforms.uAerialOwed.value = owed;
      return owed;
    },

    /**
     * Development handle: a multiplier on the level the atlas is read at.
     *
     * The gain a plate is written into the atlas with is the packing's, and
     * moving it is a repack of several minutes. This is the same multiplication
     * a frame later, which is what makes a sweep of the level a sweep rather
     * than an afternoon — and what the roster is then set to, once.
     */
    setLevel(scale) {
      if (generated) return null;
      material.uniforms.uLevel.value = CLOUDS.atlas.levelScale * scale;
      return material.uniforms.uLevel.value;
    },

    /**
     * Development handle: one LAYER of the field alone, for the same reason.
     *
     * The field is one draw of one welded geometry, which is what makes it
     * affordable and is also why hiding a mesh cannot say what the library
     * costs against what the reference's own banks cost. The triangles of each
     * sprite are contiguous in the index, so a set of kinds is a set of runs of
     * it, and swapping the index for those runs changes what is drawn and
     * nothing else about the pass — same material, same order, same state.
     *
     * @param {string[]|null} names  kinds — 'hero', 'mass', 'library' —
     *   or the identifier of a single sprite, or of the tile it was cut from,
     *   which is how a piece laid at several bearings is looked at as one thing;
     *   null for the whole field
     */
    setLayers(names) {
      if (!names) {
        geometry.setIndex(new BufferAttribute(index, 1));
        return;
      }
      const wanted = new Set(names);
      const kept = runs.filter((run) => wanted.has(run.kind)
        || wanted.has(run.id) || wanted.has(run.tile));
      const total = kept.reduce((t, run) => t + run.count, 0);
      const subset = new Uint16Array(total);
      let at = 0;
      for (const run of kept) {
        subset.set(index.subarray(run.start, run.start + run.count), at);
        at += run.count;
      }
      geometry.setIndex(new BufferAttribute(subset, 1));
    },
  };
}
