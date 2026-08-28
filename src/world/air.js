import { ShaderMaterial, Vector2, Vector3 } from 'three';
import {
  HEIGHT_FOG, SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS, SKY_UNIFORMS,
} from '../core/sky.js';
import { lightFilterGlsl, lightFilterUniforms } from './light-filter.js';
import { STRIP_REACH } from './path-strip.js';

// THE SEAT OF THE AIR, and of the surface that stands in it.
//
// WHY THIS FILE EXISTS AT ALL. Every one of these names used to live in
// src/world/terrain.js, and six other modules imported them from there:
// distant.js, monoliths.js, rocks.js, vegetation.js and both halves of the
// voxel engine. That made the ground's own file a dependency of five other
// people's work — so the session that rewrites the ground could not touch it
// without stopping four sessions that have nothing to do with the ground. The
// air is not the ground's property. It is what every surface in this world
// stands in, and it is now stated once, here, where nobody owns it.
//
// THE FILE HAS TWO HALVES AND THEY ARE NOT THE SAME KIND OF THING.
//
// PART ONE — THE AIR ITSELF: FOG_RADIANCE, LOW_SKY, GROUND_EXPOSURE, FOG_GLSL,
// setAir and fogUniforms. FROZEN IN THE FOUNDATION. These are the fitted
// constants of the picture and the one integral that puts a surface into the
// distance; two materials that disagree about any of them do not stand in the
// same world, and the join between them is a line. Nothing outside the
// coordinator moves these.
//
// PART TWO — THE BAKED SURFACE: DETAIL, STRIP and createBakedMaterial. PARKED
// HERE, NOT FROZEN. This is the material the ground and the stair share today,
// and it travelled with the air for one reason: the stair belongs to the stone
// session and the ground to the soil session, and leaving the factory in the
// ground's file would have kept exactly the collision this move exists to end.
// It is the paving's material, so it is the soil's and the path's to take, and
// the first session that rewrites the ground material takes it out of here.
// Said out loud so that nobody reads "frozen" over the whole file and stops.

// Colour the ground fades into, measured on the reference where the meadow
// meets the standing water at the horizon, and carried as radiance because that
// is what the frame is built in.
//
// It is the air the distance in distant.js is drawn in, and for the same
// reason: the meadow has to arrive at the horizon as the identical colour the
// distance already carries, or the join between them is a line. Solved off the
// reference by tools/terrain/probe.mjs rather than read off it, so the number
// is what the surface must carry rather than what the frame shows.
//
// It is not read from sky.json either, though the two now agree to within a
// tenth: that one is the air the sky bake fades into over the whole turn, and
// this is the air the ground fades into in the sector the reference frames.
export const FOG_RADIANCE = [0.165, 0.339, 0.551];

// The pale air the stone and the rocks hand back where they are seen almost
// edge on. Solved off the brightest stretch of the reference's path, which is
// the brightest thing in the lower half of the frame.
//
// It lives on here for the stone alone: the grazing gain in monoliths.js was
// fitted against the five flanks of the reference with this colour behind it,
// and the two cannot be separated without re-solving the fit.
export const LOW_SKY = [0.22, 0.40, 0.63];

// Exposure of the ground.
//
// It was four, and four was wrong. The number came from a reading of the
// reference that fed encoded pixels to an inverse tone curve expecting linear
// ones, which overstates a mid green by about the factor it was set to. Reading
// the same patch properly — tools/terrain/probe.mjs, which inverts the curve,
// the vignette and the grade together — says the reference wants a fifth of a
// unit of radiance on lit grass, not two thirds of one, and that the ground was
// being drawn three times brighter than the picture it is copying.
//
// It is not one, because the bake is a physical render and the reference is an
// illustration with lifted midtones. It is fitted, against the whole set of
// ground patches at once, and it is declared here rather than folded into the
// bake, where it would silently become part of the light.
export const GROUND_EXPOSURE = 1.25;

// Shared by every surface that has to sit in the same air. Distance fog alone
// puts as much haze on a hilltop as on the grass at its foot; the reference
// pools it low and thins it with height, which is what the second term does.
export const FOG_GLSL = /* glsl */`
  uniform vec3 uFogColour;
  uniform float uFogDensity;
  uniform float uFogHeight;
  uniform float uEyeHeight;

  // Mean density along a ray that climbs from the eye to the fragment, for a
  // density that falls exponentially with altitude. The difference of the two
  // exponentials is the closed form of the integral; the limit is taken by hand
  // when the ray is level, where that difference cancels.
  float fogAmount(float distance, float fragmentHeight) {
    float dy = fragmentHeight - uEyeHeight;
    float a = exp(-max(uEyeHeight, 0.0) / uFogHeight);
    float b = exp(-max(fragmentHeight, 0.0) / uFogHeight);
    float mean = abs(dy) < 0.01 ? a : (a - b) * uFogHeight / dy;
    float depth = distance * uFogDensity * mean;
    return 1.0 - exp(-depth * depth);
  }
`;

const TERRAIN_VERTEX = ({ detail, strip }) => /* glsl */`
  varying vec2 vUv;
  varying float vDistance;
  varying float vHeight;
${detail ? /* glsl */`
  attribute float verge;
  varying vec2 vGround;
  varying float vVerge;
` : ''}
${strip ? /* glsl */`
  attribute vec2 pathStrip;
  varying vec2 vStrip;
` : ''}
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vHeight = world.y;
    vDistance = length(cameraPosition - world.xyz);
${strip ? /* glsl */`
    // Where this vertex stands on the path's own strip. Solved once per vertex
    // on the CPU and carried, for the same reason the verge is: pathCentreX() is
    // the one seat for where the path runs, and a copy of it in GLSL would be a
    // second opinion about that. It interpolates honestly because it is affine
    // in x and very nearly so in z — the centreline drifts a metre over
    // twenty-three, so its bend across one quad of a fifth of a metre is far
    // below a texel of the strip.
    vStrip = pathStrip;
` : ''}
${detail ? /* glsl */`
    vVerge = verge;
    // Where this fragment stands on the ground, in metres, for anything that has
    // to repeat over the WORLD rather than over the atlas. It is carried from
    // here because the atlas coordinate cannot answer it: the grid is bent by a
    // power of the distance from its middle, so equal steps of vUv are not equal
    // steps of ground and a repeat driven off vUv would stretch with it.
    vGround = world.xz;
` : ''}
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// THE MATERIAL THE ATLAS CANNOT HOLD, UNDER THE WALKER'S OWN FEET.
//
// The ground atlas is bent to spend its resolution near the walker, and even
// there it runs out: measured (s3-dev4/impronta.mjs) it gives four to fourteen
// millimetres a texel ACROSS the run over the stretch the close reference of the
// path frames, and eleven to thirty-three ALONG it. sentiero-target.png, laid on
// the same ruler, has pebbles three centimetres across bedded a hand apart, and
// counting them one by one — tools/terrain/check-slabs.mjs, `peb-verge` — the
// photograph answers 14.45 stones per path width and this ground answered 7.8.
//
// AND IT IS NOT THE PAINT. Every knob of the painter's own pebble bed was run to
// both stops and the count never left 7.0 to 8.8: with the caps painted at
// ninety per cent brighter than the slab, an absurdity, the number of separated
// bright runs in the frame moved from 16.2 per path width to 16.9 against the
// reference's 23.5. What limits it is that a bright run cannot be narrower than
// about two texels of the atlas, which out at the verge is two and a bit
// centimetres, so the reference's three centimetre stones with a hand of clear
// ground between them cannot be written there at any amplitude.
//
// So the near material is repeated over the WORLD instead of stored against the
// surface: a repeat has no atlas and therefore no Nyquist of its own, and the
// mip chain of the tile does the right thing with it at every distance for free.
export const DETAIL = {
  // One repeat, in metres of ground, and the turn put on it. Both are read out
  // of here by tools/terrain/paint-detail.mjs, which writes the tile: the
  // lattices in it are stated in cells across the tile, so they are only lengths
  // of GROUND if the two agree about how much ground a tile is. One seat, read
  // rather than copied.
  metresPerRepeat: 2.0,
  // THE TURN IS NOT A DECORATION. A tile repeated straight off x and z puts a
  // lattice plane on x = 0 — every repeat boundary and every lattice node of
  // what is inside it — and x = 0 is the bearing the path runs along. That is
  // the defect paint-albedo.mjs closed in the paving by turning its slab lattice
  // twenty-seven degrees off the world's axes, and check-path-bands --along is
  // the guard that catches it. Forty, and unlike the paving's twenty-seven so
  // the two lattices do not stack.
  //
  // It also costs the repeat its period along the walk: stepping down the run by
  // d moves the tile coordinate by d*sin40 across and d*cos40 along, and the
  // pattern only comes back when BOTH are whole repeats, which for a ratio that
  // is not a fraction never happens at all.
  turn: 40,
  // Where it dies, in metres from the eye.
  //
  // NEITHER NUMBER IS A TASTE. Every guard at the reference pose reads the
  // paving from six metres out — check-slabs' own centimetre band is 6.0 to 9.6
  // and its eight-to-sixty band is 7.5 to 13.5 — and the close reference frames
  // the path from 3.6 to 6.3, so the ramp has to sit in the metre and a half
  // between them and be wide enough not to be a ring.
  //
  // AND THEY HAVE MOVED OUT FROM 5.3 AND 7.7, WHICH IS A DECISION WITH A
  // MEASUREMENT UNDER IT.
  //
  // Where they were, the tile was down to a twentieth by 7.5 metres and could not
  // touch the five readings of the eight-to-sixty band. What that also meant was
  // that `grit` — the centimetre band, read from 6.0 to 9.6 — had to be carried
  // almost entirely by the ATLAS, and the atlas CANNOT carry a centimetre band
  // without stretching it: across the run a texel is four to fifteen millimetres
  // and along it thirty-three to sixty-five, so a band stated at three
  // centimetres comes out three by nine and reads as strokes down the run. At the
  // reference pose that ratio is very nearly what the picture foreshortens the
  // run by, so there they read round; at a steep pose close to the walker they do
  // not, and that is what the committente rejected on 2026-08-26 as dark smears
  // down the middle of the path. It is proved to be that band and nothing else in
  // s3-dev7/look/tooth-cmp.png: the same paving painted with it at nought, a
  // third and full, everything else identical.
  //
  // So the band has been cut by two thirds in the paint and the centimetre scale
  // handed to this tile, which is 3.9 mm a texel and isotropic and can hold it.
  // For the tile to answer for `grit` it has to still be alive where `grit`
  // reads, and that is what 6.4 to 10.4 is.
  //
  // WHAT IT COSTS THE FIVE, MEASURED AND NOT ASSUMED. The tile has mean a half by
  // construction, so what crosses the ramp is an AMPLITUDE and not a level: it
  // adds material to the ground without moving how bright the ground is, and how
  // bright it is is the fitted palette. See the verbale of the unit that moved
  // them for the readings before and after.
  //
  // A ramp of four metres rather than a step, because a step would be a ring on
  // the ground standing at a fixed distance from the eye, which is exactly what
  // check-path-bands exists to reject.
  // AND THEY HAVE MOVED OUT AGAIN, TO 13.5 AND 17.5, WHICH IS THE SAME DECISION
  // TAKEN ONE STEP FURTHER AND FOR THE SAME MEASURED REASON.
  //
  // The move to 6.4-10.4 handed the centimetre band to this tile because the
  // atlas stretches it three to one along the run. What that left unsaid is that
  // the atlas is not only anisotropic near the walker, it is MAGNIFIED: at the
  // standing place the committente judges from, one of its texels covers three to
  // ten screen pixels across the run and sixteen to thirty-two along it. So every
  // band the atlas paints on the near paving is a soft elongated blob whatever
  // its wavelength, and those blobs are the "poor quality" he named in the
  // ordinary texture of the path. Cutting them out of paint-albedo.mjs is what
  // closes that — and it takes with it the five readings at the reference pose
  // that were being carried by the same bands, because check-slabs weighs them
  // between 7.5 and 13.5 metres and this tile was dead by 10.4.
  //
  // So the tile has to still be alive where those readings are taken. Nothing
  // else in this world can carry a centimetre band without stretching it.
  fade: [13.5, 17.5],
  // How hard it bites, as a fraction of the albedo per unit of the tile either
  // side of its middle. Set against the count itself: see the note in
  // tools/terrain/paint-detail.mjs for why the shape of the tile is the
  // painter's and this one number is not.
  //
  // IT CAME DOWN FROM TWO WHEN THE SHADE ARRIVED, and it is the same number
  // twice rather than a taste. check-slabs counts a stone as a bright run with
  // the ground going down on both sides of it; at two, with the paint alone, it
  // answered 14.78 stones per path width at the verge against the photograph's
  // 14.45, and the little shade below adds a whole stone more (15.78 measured on
  // a real render). At 1.40 with the shade the count is 14.79 — the same reading
  // as before, carried by shape instead of by pigment, which is what the
  // photograph carries it with. `grit` gains margin on the way (0.83 points of
  // its 1.15 before, 0.70 after) because a fifth less pigment at the far end of
  // the fade is a fifth less of it inside the band that reading is taken over.
  // AND IT WENT UP WITH THE TILE'S OWN CONTENT COMING DOWN. The tile lost its
  // forty and fifteen centimetre lattices — they were a second paving and the
  // reason this round exists — and with them most of its own deviation, from
  // 0.299 and 0.229 on the two channels to 0.095 and 0.058. This is what puts
  // the material that IS still in it back at the strength the paving needs.
  // Swept on the render and not guessed (`s3-dev9/forza.mjs`, which can do it
  // because this is a uniform: a candidate costs a redraw, not a repaint and a
  // bake). Two readings still standing move the SAME way with it and opposite
  // ways with everything else — `grit`, the centimetre band six to nine metres
  // out, and `edge`, the share of the tone change that happens at boundaries:
  // more material inside a piece is more centimetre band AND a smaller share of
  // the change at its edges. Above about two and a half the fine crackle closes
  // into a net, which the crop says before any number does.
  gain: 2.20,
  // WHERE IT LANDS: on stone, and not on grass.
  //
  // The material this carries is grit and bedded pebbles, which belong to the
  // paving; the meadow is S4's and has its own cards over it. The mask is taken
  // off the albedo already in hand rather than out of a second map, because the
  // albedo already knows: measured (s3-dev3), a slab of this world carries 12%
  // of green over its own luminance at the median and 27% at the ninety-fifth,
  // and a blade carries 65%. So the same ratio check-slabs separates blade from
  // slab by separates them here, for the cost of a dot product and no bytes.
  //
  // It also means the mask follows the paint's own eaten, ragged edge exactly,
  // which no second map could be kept in register with.
  stone: [0.30, 0.50],
  // AND THE PAN AND THE VERGE ARE NOT THE SAME MATERIAL, in the photograph or
  // here. Down the middle of its width the close reference shows worn pan —
  // quiet stone, a few chips, the odd crease. In the last half of it the paving
  // has broken and what is there is a bed of packed gravel, and that is where
  // check-slabs' `peb-verge` counts 14.45 stones per path width against 12.47 on
  // the pan.
  //
  // The first cut of this had ONE material turned down to a third on the pan,
  // and one material turned down is still the same material: a bed of packed
  // gravel at a third is a bed of packed gravel, and the eye read the body of
  // the path as a uniform cellular mosaic — which is what a lattice with one
  // crest and one trough per cell IS, spread over a surface that should be flat.
  // Measured on the same profile check-slabs counts stones with
  // (s3-dev6/contrasto.mjs): the photograph bites 12.76% at the median down the
  // middle and 21.87% at the verge, a ratio of 1.71; that ground bit 15.16% and
  // 22.10%, a ratio of 1.46 — the two halves of the path were nearly the same
  // material, and the body was a fifth too loud.
  //
  // So the tile carries BOTH, one to a channel, and this is the crossing between
  // them. Both have mean a half, so the crossing does too at every point of
  // itself, which is the property the level of the paving rests on.
  //
  // Where across the path this fragment stands is carried as a VERTEX
  // ATTRIBUTE and not solved in the shader: pathCoord() is the one seat for the
  // path's shape, it is arithmetic with a noise in it, and the grid near the
  // stone is nineteen centimetres a vertex, which is four vertices across the
  // ramp below. Copying that shape into GLSL would be a second definition of
  // where the path is, and the first thing S3 learned is what happens when the
  // paint and the shape disagree.
  verge: [0.20, 0.44],
  // THE LITTLE SHADE, which is the one thing in this world that is lit at draw
  // time, and the whole reason it is allowed to be.
  //
  // WHAT THE PAINT COULD NOT REACH. The close reference's near paving stands its
  // crests 33% above their own nine centimetre surround at the median and 103%
  // at the ninetieth (s3-dev4/firma.mjs). The material above is a MULTIPLIER on
  // the albedo — one plus a gain times the tile either side of its middle — so a
  // crest at +103% of its surround costs a trough at nought somewhere else, and
  // nought is the floor: the multiplication cannot get there and the measurement
  // said so. What the photograph has at that scale is not more pigment, it is
  // RELIEF: stones that take the light on one flank and keep it off the other.
  //
  // HOW IT IS DONE, AND WHY IT IS ONE TAP AND NOT A MAP. The tile is a HEIGHT as
  // well as a shade — in this paving the bright stone is the stone standing
  // proud and the dark pocket is the hollow, which is what the painter draws and
  // what the photograph shows — so the slope the sun needs is the slope of the
  // tile, and the slope along ONE direction is all a sun needs:
  //
  //     N = (-dh/dx, 1, -dh/dz)   =>   N.L / L.y = 1 - (grad h . L.xz) / L.y
  //
  // and (grad h . L.xz) is a single directional derivative, which is the tile
  // read a second time a step FURTHER UP-SUN, minus the tile here. So the whole
  // term costs one more fetch of a texture already in hand and NOT ONE BYTE of
  // delivery — against the four hundred and forty kilobytes a stored slope pair
  // would have added to the first frame (measured: 611 993 bytes of KTX2 for two
  // channels against 1 052 445 for three, on this very tile).
  //
  // AND THE STEP IS TAKEN WITH THE SUN VECTOR ITSELF, unnormalised, which is
  // what makes the arithmetic come out exactly: displacing by L.xz*step moves the
  // ground by |L.xz|*step, so the difference divided by `step` IS grad h . L.xz
  // with no length to divide out and no second copy of where the sun is. There
  // is one sun in this world, in src/core/sky.js, and this reads it.
  //
  // IT IS ALSO WHY THERE IS NO SHIMMER TO PAY FOR. Both fetches go through the
  // same mip chain and the same anisotropic filter, and what is used is their
  // DIFFERENCE, linearly: the mean of a difference is the difference of the
  // means, so a mip level is exactly the right answer for the ground it covers
  // rather than an average of normals pretending to be the normal of an average.
  // As the ground gets further away the chain flattens the tile and the term goes
  // to nothing on its own, before the fade even reaches it.
  relief: {
    // How far up-sun the second fetch is taken, in metres of ground. About half
    // a small stone: shorter and it reads the texel grid, longer and it stops
    // being the slope of a stone and becomes the tilt of the ground under it.
    step: 0.018,
    // What one unit of the tile is worth as HEIGHT, in metres. Six or seven
    // millimetres over the whole span of the field, which is what a bedded
    // pebble of two to four centimetres stands proud by.
    // Raised with the tile's own range coming down, for the same reason the gain
    // above was: what this number converts is ONE UNIT OF THE FIELD, and the
    // field now spends a third of the range it used to.
    height: 0.0090,
    // Below this sine of the sun's elevation the term stops growing and then
    // fades out. Dividing by the sun's height is what makes a slope into a
    // shading, and it is also what would make a sun on the horizon multiply a
    // millimetre of stone into a black bar: an evening has to arrive without
    // the ground catching fire. Nothing today is anywhere near it — the sun of
    // the seat stands at 34 degrees, sine 0.56.
    lowSun: [0.05, 0.25],
    // What the sun term may be multiplied by. The floor is not nought: a stone's
    // shaded flank in this world still has the whole sky on it, and a hard nought
    // would draw a terminator across every pebble instead of a shade.
    //
    // AND THE FLOOR CAME UP FROM 0.15, WHICH THE CROP FOUND AND NO NUMBER DID.
    // With the tile's own range spent three times over on fewer, stronger things,
    // the deepest pockets drive this term ONTO the floor — and a fragment whose
    // sun term is a seventh is a fragment lit almost entirely by the sky, which
    // in this world is blue. The crop at the committente's own standing place
    // shows them: a scatter of small blue-black specks where there should be
    // hollows in grey stone. It is the model's own limit and not a hollow's: what
    // is stored is a SLOPE, and a slope of six millimetres cannot take all the
    // sun off anything. Four tenths is where a shaded flank of a pebble in this
    // light actually sits.
    clamp: [0.40, 2.00],
  },
};

// THE JOINTS OF THE PAVING, AS A DISTANCE RATHER THAN AS A PICTURE.
//
// The committente rejected the middle of the path on 2026-08-26 as dark smears
// running down the run. One cause was the tooth of the atlas and is closed. The
// other is the atlas itself, and no amount of paint closes it: the ground atlas
// is bent to spend its resolution near the walker and it still gives four to
// fifteen millimetres of ground to a texel ACROSS the run and thirty-three to
// sixty-five ALONG it, so a joint of the paving — a step in tone a few
// millimetres wide — is written there as a smear the better part of a hand long.
// At the reference pose the picture foreshortens the run by very nearly that
// ratio, so it reads round; from a steep pose close to the walker it does not.
//
// WHAT CHANGES IS WHAT IS STORED, NOT HOW MUCH. The atlas's Nyquist limits what
// can be DRAWN, not what can be SAID. src/world/path-strip.js carries a strip
// laid along the run whose every texel holds ONE number — how far the nearest
// joint edge is, in millimetres — and the frame compares that against a width.
// Eight bits of distance interpolate to a POSITION, and a position survives a
// coarser texel than an edge does: measured against the lattice it is a ruler
// for, the joint's edge lands within 2.80 mm of where the paving puts it at the
// median, and it lands there as well along the run as across it.
//
// AND IT IS ONE FETCH, ON THE ALBEDO, AND NOTHING ELSE.
//
// No second tap. The near material above takes a second reading of its tile a
// step up-sun because that tile IS a height and the difference of two readings
// of a height is a slope. A distance is not a height: the gradient of a distance
// field is one everywhere by construction, so a shade built from it would be a
// shading with no physical fact under it, on the very ground where the smears
// were rejected. Leaving it out also halves the fill, which is the only real
// lever on the cost.
//
// And it multiplies the ALBEDO, never `terms`. The soil in a slot is darker
// than the stone beside it — that is a pigment, and pigments live in the albedo.
// Putting it on the light would make the joint a function of the hour and would
// reach the one pair of numbers every other guard in this file is weighed on.
export const STRIP = {
  // Where it dies, in metres from the eye.
  //
  // NOT A TASTE AND NOT THE NEAR MATERIAL'S. Past about twenty metres the atlas
  // is already finer than the pixel along the run — the thing this exists to fix
  // has stopped being visible — so the tail buys no definition and costs fill.
  // It is far wider than DETAIL.fade because the two answer different questions:
  // that one carries a centimetre GRAIN, which is gone from the picture by ten
  // metres, and this one carries an EDGE, which is still legible at twenty.
  //
  // Which is also why this does not ride inside the near material's branch, as
  // the plan for it assumed. That branch is shut at 10.4 m; hanging a term that
  // has to live to 22 m inside it would silently cut the joints off at ten
  // metres, in the middle of the stretch the reference pose frames.
  fade: [16, 22],
  // How far outside a joint's own edge the darkening dies, in metres.
  //
  // The stored field is nought over the WHOLE inside of a slot and grows outward
  // from its edge, so this is a shoulder and not a width: the width is the
  // paving's, per joint, and it is already in the field. Five millimetres against
  // the thirty-five the atlas's own ramp reaches, which is the sharpening.
  soft: 0.005,
  // What a joint takes out of the stone, on top of what the atlas already took.
  // Fitted on the render against check-slabs' `joint`, which reads the very band
  // this lands in: see the verbale of the unit that set it.
  dark: 0.88,
  // How quickly the strip lets go at its own two edges, per unit of the strip.
  //
  // Both are cliffs rather than ramps, and both are allowed to be because they
  // stand on ground with no paving on it — the strip is half a metre wider than
  // the stone ever gets and it starts and ends past both ends of the run. It is
  // here at all so that a texel clamped at the border can never be smeared out
  // over the meadow, and so that the fetch is skipped for every fragment that is
  // not on the path, which at the reference pose is most of the frame.
  edge: [32.0, 400.0],
};

const TERRAIN_FRAGMENT = ({ detail, strip }) => /* glsl */`
  precision highp float;
  varying vec2 vUv;
  varying float vDistance;
  varying float vHeight;
  varying vec2 vGround;
  varying float vVerge;
${strip ? /* glsl */`
  varying vec2 vStrip;
` : ''}

  uniform sampler2D tAlbedo;
  uniform sampler2D tLight;
  uniform float uLightScale;
${strip ? /* glsl */`
  uniform sampler2D tStrip;
  uniform vec2 uStripFade;
  uniform float uStripSoft;
  uniform float uStripDark;
` : ''}
${detail ? /* glsl */`
  uniform sampler2D tDetail;
  uniform float uDetailGain;
  uniform vec2 uDetailFade;
  // Where the sun is. Shared by reference with src/core/sky.js, not copied: this
  // is the same object the dome, the weather and the water read, so an evening
  // moves the shade on a pebble at the same instant it moves everything else.
  uniform vec3 uSunDir;
` : ''}
  ${SCENE_LIGHT_GLSL}
  ${lightFilterGlsl()}
  ${FOG_GLSL}

  void main() {
    // Both textures carry an sRGB transfer function, so the sampler has already
    // brought them back to linear light by the time they arrive here.
    vec3 albedo = texture2D(tAlbedo, vUv).rgb;

    // Red is how much of the sun this texel sees, green how much of the sky,
    // each stored divided down to fit eight bits.
    //
    // lightTerms() and not texture2D(): a cubic B-spline over four bilinear
    // taps, because a shadow edge is one and a half texels wide on this atlas
    // and bilinear rebuilds it as a staircase on the texel grid. See
    // src/world/light-filter.js for the measurement that says so.
    //
    // Fetched HERE, before the near material, because the little shade below
    // bends the SUN term of this pair and nothing else — not the sky term, not
    // the albedo, not the fog. A stone's shaded flank in this world is a flank
    // that has lost its sun and kept its sky, which is what a shaded flank is.
    vec3 terms = lightTerms(tLight, vUv);
${detail || strip ? /* glsl */`
    // The grit and the bedded stones of the near paving, and the joints of it:
    // see the notes over DETAIL and STRIP above for why neither can live in the
    // atlas. They share one branch and one stone mask because they ask the same
    // two questions about the same fragment.
    //
    // THE BRANCHES ARE ON DISTANCE AND ON WHERE THE PATH IS, never on the stone
    // mask, deliberately: both are smooth and coherent across a quad, so the
    // derivatives that pick the mip are defined wherever a branch is taken, and
    // at the far edge of either ramp the weight is nought anyway. The mask is a
    // multiply inside. A branch on the mask would split quads along the eaten
    // edge of the paving, where the weight is NOT nought, and hand an undefined
    // mip to the very fragments the verge is judged on.
    float near = ${detail
    ? '1.0 - smoothstep(uDetailFade.x, uDetailFade.y, vDistance)' : '0.0'};
${strip ? /* glsl */`
    // Nought off the strip, nought past the fade, one on the path close to. The
    // two clamps are what keep the fetch off every fragment that is not on the
    // path, which at the reference pose is most of the frame.
    float onPath = (1.0 - smoothstep(uStripFade.x, uStripFade.y, vDistance))
      * clamp((0.5 - abs(vStrip.x - 0.5)) * ${STRIP.edge[0].toFixed(1)}, 0.0, 1.0)
      * clamp((0.5 - abs(vStrip.y - 0.5)) * ${STRIP.edge[1].toFixed(1)}, 0.0, 1.0);
` : `
    float onPath = 0.0;
`}
    if (near > 0.0 || onPath > 0.0) {
      // WHERE ANY OF IT LANDS: on stone, and not on grass. Taken off the albedo
      // already in hand rather than out of a second map, because the albedo
      // already knows — a slab of this world carries 12% of green over its own
      // luminance at the median and a blade carries 65% — and because it then
      // follows the paint's own eaten, ragged edge exactly, which no second map
      // could be kept in register with. Solved once here and spent twice.
      float luma = max(dot(albedo, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
      float green = (albedo.g - 0.5 * (albedo.r + albedo.b)) / luma;
      float onStone = 1.0 - smoothstep(${DETAIL.stone[0].toFixed(3)},
                                       ${DETAIL.stone[1].toFixed(3)}, green);
${strip ? /* glsl */`
      // ONE FETCH, AND IT IS A RULER AND NOT A PICTURE. The strip holds how far
      // the nearest joint's EDGE is: nought over the whole inside of a slot and
      // growing outward from it. So the WIDTH of the joint is the paving's own,
      // per joint, already in the field, and what is chosen here is only how far
      // the darkening reaches past its edge.
      //
      // Unsigned is what makes this survive its own mip chain. Averaging an
      // unsigned distance over a footprint moves it AWAY from nought, so a joint
      // seen from further off thins, softens and then stops being drawn. A
      // signed field would average to nought in the middle of a slab and draw a
      // joint there instead — at a fixed offset, down the whole length of the
      // run, which is the one thing check-path-bands --along exists to catch.
      if (onPath > 0.0) {
        float gap = texture2D(tStrip, vStrip).r * ${STRIP_REACH.toFixed(4)};
        albedo *= 1.0 - (1.0 - smoothstep(0.0, uStripSoft, gap))
          * onPath * onStone * (1.0 - uStripDark);
      }
` : ''}
${detail ? /* glsl */`
      if (near > 0.0) {
      vec2 turned = vec2(
        vGround.x * ${Math.cos(DETAIL.turn * Math.PI / 180).toFixed(6)}
      + vGround.y * ${Math.sin(DETAIL.turn * Math.PI / 180).toFixed(6)},
        vGround.y * ${Math.cos(DETAIL.turn * Math.PI / 180).toFixed(6)}
      - vGround.x * ${Math.sin(DETAIL.turn * Math.PI / 180).toFixed(6)});
      // The tile has mean a half by construction — paint-detail.mjs asserts it —
      // so this multiplies the paving by one on average: it adds material to the
      // stone without moving its level, and the level is the fitted palette.
      vec2 tile = turned * ${(1 / DETAIL.metresPerRepeat).toFixed(6)};
      // ONE FETCH, TWO MATERIALS. Red is the packed gravel of the verge and of
      // the broken ground, green the worn slab down the middle, and both have
      // mean a half — so the crossing between them has mean a half at every
      // point of itself, which a single field turned DOWN on the pan also had
      // but a single field is not what the photograph shows there.
      float bed = smoothstep(${DETAIL.verge[0].toFixed(3)},
        ${DETAIL.verge[1].toFixed(3)}, vVerge);
      vec2 pair = texture2D(tDetail, tile).rg;
      float chip = mix(pair.g, pair.r, bed);
      // AND THE MULTIPLIER HAS A FLOOR, which it did not and needed one the moment
      // the gain went over two. The tile is stored as codes about a half, so this
      // factor runs 1 - gain/2 to 1 + gain/2: at 2.20 its low end is MINUS a
      // tenth, and a reflectance that goes through zero turns the deepest pockets
      // inside out. They came back as small blue-black specks — a fragment whose
      // albedo is nearly nothing is a fragment showing the sky term and nothing
      // else, and in this world the sky is blue. The crop found them and no
      // reading did. A hollow worn into stone still hands back a little light,
      // which is what this floor is; it bites on the 0.009% of texels the tile
      // clips at, and nowhere else.
      albedo *= max(1.0 + near * onStone * uDetailGain * (chip - 0.5), 0.06);

      // THE LITTLE SHADE. One more fetch of the tile, a step further UP-SUN, and
      // the difference between the two is the slope of the stone along the one
      // direction a sun cares about. See the note over DETAIL.relief.
      //
      // The step is the sun's own horizontal vector times a length in metres,
      // turned into the tile's axes by the same rotation the coordinate above
      // was: what comes back is grad(h) . L.xz with nothing left to normalise.
      vec2 upSun = vec2(
        uSunDir.x * ${Math.cos(DETAIL.turn * Math.PI / 180).toFixed(6)}
      + uSunDir.z * ${Math.sin(DETAIL.turn * Math.PI / 180).toFixed(6)},
        uSunDir.z * ${Math.cos(DETAIL.turn * Math.PI / 180).toFixed(6)}
      - uSunDir.x * ${Math.sin(DETAIL.turn * Math.PI / 180).toFixed(6)});
      vec2 pairUp = texture2D(tDetail,
        tile + upSun * ${(DETAIL.relief.step / DETAIL.metresPerRepeat).toFixed(6)}).rg;
      // The same crossing, at the same place across the path: the step is under
      // two centimetres and the crossing is a quarter of a metre wide, so the
      // two ends of it stand in the same material by construction.
      float above = mix(pairUp.g, pairUp.r, bed);
      // Dividing by the sun's height is what turns a slope into a shading, and
      // it is held off the floor so an evening cannot turn a millimetre of stone
      // into a black bar; under it the whole term lets go.
      float sunLift = smoothstep(${DETAIL.relief.lowSun[0].toFixed(3)},
        ${DETAIL.relief.lowSun[1].toFixed(3)}, uSunDir.y)
        / max(uSunDir.y, ${DETAIL.relief.lowSun[1].toFixed(3)});
      terms.r *= clamp(1.0 - near * onStone * sunLift
        * ${(DETAIL.relief.height / DETAIL.relief.step).toFixed(6)} * (above - chip),
        ${DETAIL.relief.clamp[0].toFixed(3)}, ${DETAIL.relief.clamp[1].toFixed(3)});
      }
` : ''}
    }
` : ''}
    // Where the pair becomes light again — and where an evening would become a
    // different light off the same two numbers.
    vec3 light = bakedLight(terms) * uLightScale;

    vec3 colour = albedo * light;
    colour = mix(colour, uFogColour, fogAmount(vDistance, vHeight));
    gl_FragColor = vec4(colour, 1.0);
  }
`;

/**
 * The material every baked surface uses: a painted albedo, a Cycles bake, and
 * the same air as the ground.
 *
 * Shared rather than copied because the stair has to sit in the meadow, not on
 * top of it: one fog, one exposure, one way of turning a stored map back into
 * light. Two materials with the same intent drift apart on the first change.
 */
export function createBakedMaterial({
  albedo, light, lightScale, detail = null, detailGain = 0, strip = null,
}) {
  return new ShaderMaterial({
    uniforms: {
      tAlbedo: { value: albedo },
      tLight: { value: light },
      uLightScale: { value: lightScale * GROUND_EXPOSURE },
      ...(strip ? {
        tStrip: { value: strip },
        uStripFade: { value: new Vector2(...STRIP.fade) },
        // The width of a joint is a NUMBER in the shader now, which is the point
        // of the whole strip: it used to be whatever two texels of the atlas came
        // to at that distance, and there was no knob at all.
        uStripSoft: { value: STRIP.soft },
        uStripDark: { value: STRIP.dark },
      } : {}),
      ...(detail ? {
        tDetail: { value: detail },
        uDetailGain: { value: detailGain },
        uDetailFade: { value: new Vector2(...DETAIL.fade) },
        // By reference and not a copy of the vector: the seat writes into this
        // very object when the preset changes, so there is nothing to keep in
        // step and nothing that can fall out of it.
        uSunDir: SKY_UNIFORMS.uSunDir,
      } : {}),
      ...lightFilterUniforms(light),
      ...SCENE_LIGHT_UNIFORMS,
      ...fogUniforms(),
    },
    vertexShader: TERRAIN_VERTEX({ detail: Boolean(detail), strip: Boolean(strip) }),
    // WITH NEITHER MAP THIS IS THE SHADER IT ALWAYS WAS, to the character. The
    // stair shares this factory and passes neither, so it compiles the same
    // source as before and cannot be moved by any of this: it carries its own
    // atlas at a fixed side, fine enough already, and the defects these close
    // are both the bent meadow atlas running out under the walker's feet.
    fragmentShader: TERRAIN_FRAGMENT({ detail: Boolean(detail), strip: Boolean(strip) }),
    fog: false,
  });
}

// ONE SEAT FOR THE AIR, and two reasons it is one rather than a copy per
// material.
//
// The first is the eye. `uEyeHeight` was the literal 1.7 in every material and
// nobody ever wrote to it, so the height integral believed the walker was
// standing on flat ground at all times — on the platform, at the top of the
// stair, on a hummock, at three metres up, it still integrated from one metre
// seventy. The camera moves now, and it climbs, so this is written every frame
// and it has to reach every material that stands in the same air.
//
// The second is the hour. The colour of the air is not a constant of this world,
// it is what the sky puts on a level patch, and there is going to be a night.
// So it is DERIVED from the light the sky is already handing the ground —
// `uSkyLight`, which src/core/sky.js sets from the preset — rather than written
// down a second time. What was measured off the reference is kept as the RATIO
// between the two, so today it reproduces the fitted radiance exactly and a
// different preset moves the air with the sky instead of leaving it at noon.
//
// What the ratio does NOT carry is the change in the SHAPE of the scattering
// with the sun's height: it carries level and tint, which is what the join
// between the meadow and the distance is made of, and not the way the aureole
// swings round. Written down rather than implied.
const AIR = {
  uFogColour: { value: new Vector3(...FOG_RADIANCE) },
  uEyeHeight: { value: 1.7 },
};
const AIR_PER_SKY = new Vector3(...FOG_RADIANCE).divide(
  new Vector3().copy(SCENE_LIGHT_UNIFORMS.uSkyLight.value),
);

/**
 * Tells the air where the eye is, and what hour it is.
 *
 * Called once a frame from the hub, which is the one place that knows both.
 *
 * @param {number} eyeHeight  metres above the world's zero
 */
export function setAir(eyeHeight) {
  AIR.uEyeHeight.value = eyeHeight;
  AIR.uFogColour.value.copy(SCENE_LIGHT_UNIFORMS.uSkyLight.value).multiply(AIR_PER_SKY);
  return AIR;
}

export function fogUniforms() {
  return {
    // Shared by reference, not copied: see AIR above.
    uFogColour: AIR.uFogColour,
    uFogDensity: { value: HEIGHT_FOG.densityAtGround },
    uFogHeight: { value: HEIGHT_FOG.scaleHeight },
    uEyeHeight: AIR.uEyeHeight,
  };
}
