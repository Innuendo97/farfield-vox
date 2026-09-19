import { ShaderMaterial, Vector2, Vector3 } from 'three';
import { AIR_NEAR, HEIGHT_FOG, SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS } from '../core/sky.js';

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
// PART TWO — THE BAKED SURFACE: createBakedMaterial, and the two shaders it
// compiles. PARKED HERE, NOT FROZEN. It travelled with the air for one reason:
// the stair belongs to the stone session and the ground to the soil session,
// and leaving the factory in the ground's file would have kept exactly the
// collision this move exists to end. Said out loud so that nobody reads
// "frozen" over the whole file and stops.
//
// IT IS ONE SURFACE NOW AND NOT TWO. This part also held DETAIL and STRIP, the
// near material of the paving and the joints of it as a distance -- both
// written for the bent grid, both without a caller since that mesh went, both
// retired at step 8 with the maps they read. What is left is the STAIR: a
// painted albedo times a Cycles bake, in the air the meadow stands in, which is
// what this factory was before either was added to it and what the one surface
// that still calls it passes. The whole argument for the retirement is written
// where the two used to be.

// Colour the ground fades into, carried as radiance because that is what the
// frame is built in.
//
// It is the air the distance in distant.js is drawn in, and for the same
// reason: the meadow has to arrive at the horizon as the identical colour the
// distance already carries, or the join between them is a line.
//
// REFITTED AGAINST THE TARGETS' OWN AIR, AND THE OLD NUMBER WAS FIFTEEN LEVELS
// TOO RED AND TWENTY-TWO TOO LITTLE BLUE. What was measured is a PIXEL and not
// a radiance: 499 px of clear sky within half a degree of the horizon of the
// day target, with the frame's corner shading divided out of every sample,
// reading 115.1 / 169.7 / 204.2 in eight bits. So the constant is not that
// reading -- it is the radiance that DEVELOPS to that reading through the same
// chain the frame develops everything through, and it was solved by driving
// tools/lighting/render-chain.mjs, which is the chain the guards already judge
// the light with, until the developed air landed on those three numbers.
//
// THE RESIDUAL, DECLARED. Rounded to the four decimals this file carries, the
// constant develops to 115.11 / 169.70 / 204.20: a hundredth of a level on red
// and under a thousandth on the other two. The measurement it is being fitted
// to is worth far less than that, and the honest error bar is the one on the
// two chains rather than on the solve -- the analysis read its pixels through
// the FITTED POLYNOMIAL of the grade and this reads them through the DELIVERED
// cube, and on the constants they both had in hand the two disagree by 0.01 to
// 0.40 of a level. That is the real precision here.
//
// AND IT LANDS NEAR A NUMBER NOBODY FITTED IT TO. The sky bake records the
// dome's own air a degree and a half above the horizon opposite the sun --
// fogRadiance in assets-src/sky/sky.json, 0.14509 / 0.39725 / 0.85856 -- and
// this agrees with it to 2% on green and 4% on blue while standing at 45% of
// its red. The ground's air and the sky's air were a level and a tint apart on
// two channels of three; they are now apart on one, and the one they are apart
// on is the one the targets are emphatic about.
export const FOG_RADIANCE = [0.0648, 0.3903, 0.8946];

// THE CEILING ON THE LOW HAZE, AND IT IS THE HAZE AT ITS OWN LAST WINDOW.
//
// E-LUCE2 fitted the haze on four windows of the reference's meadow, the
// furthest at sixty metres. Beyond that it was an extrapolation and it
// saturated at three hundred metres: a grey term at one, on everything. The
// reference does not do that — at four hundred metres it veils red by a quarter
// and blue by nearly two thirds — so the grey stops.
//
// WHERE IT STOPS IS NOT A CHOICE, AND IT USED TO BE ONE. It stood at 0.13,
// described in this file as "what it is worth a little past the last window it
// was measured on", and "a little past" is the whole of the difference between a
// fit and a number somebody picked. It is now the haze AT that window: sixty
// metres, on the meadow a metre up, from the walking eye — the ray that window
// IS — through the same density and the same scale height, which comes to
// 0.110874. So the fit is kept exactly where it was measured and stops exactly
// where it stopped being measured, with no metres of extrapolation past it.
// guard-aria recomputes it from the two numbers in the seat rather than
// comparing it to a literal, so a density or a scale height that moved would
// move the ceiling with it.
//
// AND THE RAY IS THE WINDOW'S OWN AND NOT A LEVEL ONE, which is a difference of
// eighteen ten-thousandths and was measured before it was chosen. A ceiling is a
// scalar clamp on a term that is a function of distance AND height, so "where it
// was fitted" is a set of rays and the ceiling has to be the largest value the
// haze took on any of them — otherwise the clamp reaches back into the fit. Read
// along a level ray it comes to 0.109143, and that number CUTS the last window
// by two thousandths of a fraction: 0.23 of an L* on the meadow's south flank in
// shadow at sixty metres, which takes this file's whole change there from 0.80
// to 1.03 and past the one L* E-LUCE2's walk is held to. What it buys is 0.13 of
// rms on the three planes and not one level on any of them — the near flank and
// the pale veil develop to the same three numbers either way. A tenth of a level
// is not worth a fit, so the ceiling is the window's own ray.
//
// WHAT THE OLD "a little past" WAS COSTING, measured on the pigment rather than
// on a floor. The ceiling is not additive, it is a MIX: at the near flank it
// replaces eleven per cent of a rock in shadow — a blue of 0.104 — with the fog's
// own 0.895, and that is the whole of what stands between that plane and its
// reference now that the distance term declines to reach it. The near flank goes
// 79 / 120 / 137 to 79 / 118 / 133 and the rms on the three planes 14.12 to
// 12.79, and it costs the walk 0.03 of an L* at the last window and nothing at
// any other, because the haze is under this value at every one of them. D-L8-1.
//
// AND WHAT IS STILL NOT CLOSED BY IT. At zero the near flank would land on
// 74 / 104 / 103 exactly, which is its reference — see AIR_PATH_ORIGIN for why
// that is a statement about the palette and not about the air. Zero is not
// available: below this the ceiling starts cutting into the windows the haze was
// fitted on, and E-LUCE2's walk is not this term's to spend.
export const FOG_LOW_CAP = 0.110874;

// THE DISTANCE, PER CHANNEL: Rayleigh, and now at Rayleigh's own ratio.
//
// WHAT THESE ARE FITTED TO, AND ON WHOSE SCALE. R6 §4.4 published a triple read
// off the reference's middle crest, and R6 §2.3 publishes the column it was read
// from: the crest veiled 0.25 on red, 0.44 on green, 0.62 on blue. That column
// is RELATIVE. R6 §2.3 builds it on a scale whose 0 / 0 / 0 is the near flank in
// shadow and whose 1 / 1 / 1 is the pale far hills, so it is the fraction of the
// way FROM THE NEAR FLANK to the pale veil, and not the fraction of air between
// the eye and the crest.
//
// TWO UNITS READ IT AS THE SECOND AND BOTH LOST THE PICTURE. U-CORNICE-2 §11
// caught the confusion and D-C2-1 ordered a refit; U-LUCE-6 derived the triple
// the relative reading asks for UNDER THE OLD SHAPE — 0.001776 / 0.002521 /
// 0.003257 — and measured that it puts the air alone OVER the reference on all
// three channels at the crest, which is a plane no palette then reaches, while
// leaving MORE air on the near flank rather than less. The measurement was right.
// The conclusion drawn from it — that no triple does both — was right about
// every triple and wrong about the reason.
//
// IT WAS NEVER THE TRIPLE. It was that the LAW had its zero in the wrong place,
// and the law is now written so that its zero is where R6's column has one: see
// AIR_PATH_ORIGIN below and the note over FOG_GLSL. Once the origin of the path
// is the near flank, the relative column and the absolute one are the same
// column, and R6's three numbers can be read off it with no refit at all. These
// three ARE that column, inverted through Beer-Lambert over the 174 m of optical
// path that separate the near flank from the crest:
//
//     beta = -ln(1 - f) / (u_crest - u_origin),   f = 0.25 / 0.44 / 0.62
//
// AND THE CHECK NOBODY FITTED THEM TO. Blue over red comes out 3.36. Pure
// Rayleigh scattering is 3.3. The triple that shipped before stood at 2.36 and
// R6's own reading of the reference is 2.5 — and the reason the old triple could
// not get there is arithmetic rather than measurement: under a gaussian in the
// path it is the SQUARE of the depth that carries the fraction, so a fit against
// this column can only ever produce the square root of the true ratio, and the
// square root of 3.36 is 1.83. The shape was hiding the physics in plain sight,
// and the two numbers that agree here were solved a decade of pages apart.
//
// WHO OWNS WHAT IS LEFT AT THE NEAR FLANK, in levels, MEASURED ON THE PIGMENT.
// The plane reads 79 / 120 / 137 against a reference at 74 / 104 / 103. This
// term's share of that is 0 / 0 / 0, because the law is zero at that plane by
// construction, and the whole 5 / 16 / 33 is the low haze's CEILING, which is
// E-LUCE2's and frozen.
//
// AND THAT IS NOT WHAT THIS FILE USED TO SAY. It said 37 of 45 levels of blue
// were this term's and 8 the ceiling's, and it said it from a reading taken with
// THE PIGMENT AT ZERO — a floor of 148 against a target of 103. A floor is the
// ADDITIVE half of the air; the ceiling is not additive, it is a MIX, and what a
// mix costs depends on how dark the surface it stands in front of is. At pigment
// zero it replaces nothing and looks cheap; over the rock in shadow it replaces
// a blue of 0.104 with a fog of 0.895 and costs 33. The two owners were the
// right two and their sizes were the wrong way round.
export const AIR_BETA = [0.001653, 0.003331, 0.005559];

// THE FAR END OF THE COLOUR, and it is PALER THAN THE SKY.
//
// R6 §2.3 reads the reference's most distant hills at 149 / 187 / 213 — L* 77,
// chroma 19, ten levels above the plateau the sky itself keeps between four and
// fourteen degrees. This is the radiance that develops to those three numbers
// through the same chain the frame develops everything through, solved rather
// than chosen, and it agrees with them to a tenth of a level.
export const AIR_PALE = [0.198800, 0.603064, 1.196391];

// WHERE THE PATH IS MEASURED FROM, and this is the one number the shape is.
//
// THE AIR OF THE FIRST 227 METRES IS ALREADY IN THE PIGMENT. U-CORNICE-2 solved
// the cornice's palette WITH THE AIR SWITCHED OFF, against the class mask of the
// reference's near flank — so `palette()`'s rock in shadow develops to
// 74 / 104 / 103, which is that plane's reading in the reference, air of the
// reference included. The pigment is not a mineral: it is what that plane LOOKS
// LIKE from here. Putting this world's own air in front of it a second time is
// counting the same air twice, and it is measurable: 21 of the near flank's 55
// levels of blue used to be exactly that double count.
//
// AND R6 SAYS THE SAME THING IN ITS OWN LANGUAGE. R6 §2.3's column of air
// fractions is built on a scale whose zero is the near flank in shadow. Every
// number the campaign has about the colour of the distance is measured FROM that
// plane. So the law's zero belongs there too — not at the eye.
//
// IT IS THE NEAR FLANK'S OPTICAL PATH AND NOT ITS DISTANCE. 227 m out and 21 m
// up, through the height integral both terms share, comes to 175 m of path at
// the judging eye. Stated as a path rather than as a distance so that a hilltop
// and the grass at its foot cross it at different distances, which is the whole
// reason the integral exists.
//
// WHAT IT COSTS THE WALK, MEASURED. Inside this origin the distance term is
// exactly nothing, so everything nearer than about 180 m loses whatever of it
// used to be there. On the stone, per face of masonry-spec `palette`, the worst
// is 0.64 L*; on the meadow at sixty metres, which is the furthest window
// E-LUCE2 fitted the low haze on, the worst is 0.80 L* on a south flank in
// shadow. Both inside the one L* E-LUCE2's walk is held to. AND IT LANDS CLOSER
// TO E-LUCE2 THAN BEFORE: the walk's own green fraction reads 0.0393 at 35 m and
// 0.1112 at 60 m against the 0.04 and 0.11 E-LUCE2 measured, where the shipped
// air read 0.0433 and 0.1220 — because the distance term was leaking into the
// window the low haze was fitted on, and now it does not.
//
// BEYOND SIXTY METRES THE MEADOW DOES MOVE: −1.3 L* at eighty and −2.0 at a
// hundred, where the turf ends. Nobody ever fitted the air out there — E-LUCE2's
// four windows stop at sixty and E-LUCE4 extended a term past them without
// re-measuring — so this is declared rather than defended, and it is a residual
// of this unit and not a claim.
export const AIR_PATH_ORIGIN = 175;

// The pale air the stone and the rocks hand back where they are seen almost
// edge on. Solved off the brightest stretch of the reference's path, which is
// the brightest thing in the lower half of the frame.
//
// It lives on here for the stone alone: the grazing gain in monoliths.js was
// fitted against the five flanks of the reference with this colour behind it,
// and the two cannot be separated without re-solving the fit.
//
// AND THAT IS WHY IT DID NOT MOVE WITH THE AIR ABOVE, WITH THE NUMBER SAID OUT
// LOUD. Driven through the same chain it develops to 142.4 / 167.3 / 186.6,
// against the targets' air at 115.1 / 169.7 / 204.2 -- twenty-seven levels too
// red and eighteen too little blue, a wider gap than the one just closed. The
// reason it stays is not that the gap is small. It is that this is not the air:
// it is a grazing return, and in the fragment it stands MULTIPLIED by a gain
// fitted against five flanks with this very colour behind it. Refitting one
// half of a product against a measurement of something else is how a fit gets
// lost, and the other half is already spoken for -- the grazing term's own
// refit is assigned to the stone session, with its night half waiting on the
// night session. So this moves when that fit is re-solved, by whoever re-solves
// it, and until then it is a declared debt and not an oversight.
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

// THE AIR IS TWO TERMS AND THE SECOND IS PER CHANNEL, and both halves of that
// sentence are a measurement.
//
// WHAT WAS HERE BEFORE. One gaussian in (distance x density x the height
// integral), one colour, the same fraction on all three channels. It was fitted
// by E-LUCE2 on four windows of the reference's own meadow inside sixty metres
// and it is right there: 0.053 / 0.128 / 0.133 / 0.049 of air, inside the band
// the campaign measured. Past that it is an extrapolation, and R6 §2.3 caught
// it out on the reference's own hills, where three things happen that one
// colour and one fraction cannot do:
//
//   1. THE VEIL IS PALER THAN THE SKY at the far end. The reference's most
//      distant hills read L* 77 where its sky at eight degrees reads 67. A haze
//      that fades everything towards the low sky's blue can never get there.
//   2. THE CHROMA PASSES THROUGH A MAXIMUM: 17 on a near flank, 30 on the middle
//      crest, 19 on the pale far ones. The first air is BLUE — the in-scatter of
//      the sky, at hue 256 — and the second is pale. One colour has no maximum.
//   3. IT IS PER CHANNEL. Against the same near flank, the middle crest is
//      veiled 0.25 on red and 0.62 on blue: the blue goes out two and a half
//      times faster than the red, which is what Rayleigh scattering does and
//      what a single fraction cannot say at any density.
//
// SO THERE ARE TWO TERMS, and they are not a refinement of each other: they are
// two different pieces of atmosphere. THEY SHARE THE HEIGHT INTEGRAL AND THEY DO
// NOT SHARE A SHAPE, and the second half of that sentence is what this unit
// changed.
//
//   THE LOW HAZE is the aerosol E-LUCE2 fitted. Its density, its scale height
//   and its gaussian are untouched, in src/core/sky.js where guard-aria watches
//   them. What it takes is a CEILING. A grey term that goes on growing puts 0.35
//   of red on a hill four hundred metres out; the reference puts 0.25 there. The
//   ceiling is 0.13, which is the value the low haze itself reaches a little past
//   the last window it was fitted on — so the fit is kept exactly where it was
//   measured and stops exactly where it stopped being measured.
//
//   THE DISTANCE is Rayleigh, per channel, towards a colour that turns pale. Its
//   shape is BEER-LAMBERT over a path whose origin is the near flank, and until
//   this unit it was a gaussian over a path whose origin was the eye.
//
// WHY THE GAUSSIAN WENT, AND IT IS NOT A TASTE. E-LUCE4 gave this term the low
// haze's shape "so a hilltop is still less veiled than the grass at its foot".
// That property is in the HEIGHT INTEGRAL, which the two share and still share;
// it is not in the exponent. What the exponent does is decide how a column of
// air extinguishes, and a column of air extinguishes as exp(-tau). E-LUCE2's
// square was a fit of an AEROSOL near the ground over sixty metres, and lending
// it to the distance was lending a fit past the window it was fitted in. Three
// things follow from taking it back, and all three are measured:
//
//   1. R6'S COLUMN BECOMES READABLE. Under a square it is the square of the
//      depth that carries the fraction, so a triple fitted on R6's ratios comes
//      out at their square root: blue over red 1.83 where Rayleigh is 3.3. Under
//      Beer-Lambert the same column gives 3.36. See AIR_BETA.
//   2. THE FAR HALF KEEPS ITS DEPTH. R6 §2.2 asks for four planes readable as
//      four distances. A steep law saturates: swept over exponents, at the square
//      the hills at 820 m and the pale hills at 1550 m come to 4 / 2 / 0 levels
//      apart, which is one plane where the reference has two. At Beer-Lambert
//      they stand 17 / 13 / 6 apart, which is where the shipped air had them.
//   3. THE PICTURE IMPROVES ON FIVE PLANES AND NOT ONLY ON THREE. Rock in shadow
//      through the air, developed: the three planes the fit is against go from
//      21.06 to 14.12 levels of rms, and R6's five go from 27.27 to 22.88.
//
// THE PALE VEIL IS SECOND ORDER, WHICH IS WHY THERE IS NO LONGER A TURN LENGTH.
// The colour the distance goes out into runs from the sky's own blue — the
// in-scatter, which is light scattered ONCE — to a pale veil that is light
// scattered more than once. The weight of the second is the square of the first,
// so the turn is f.g * f.g and not a second exponential in metres. What leaves
// with it is AIR_TURN_METRES: 700 m, anchored on two distances that came out of
// the same air it was describing (U-LUCE-7 residuo 3). The turn now has no
// length in it, no fitted exponent, and one multiply.
//
// AND THAT IS ONE TRANSCENDENTAL FEWER PER FRAGMENT, not one more.
//
// THE ORDER OF THE TWO IS PHYSICS AND NOT TASTE. The distance veils the surface;
// the low haze veils what comes out of that, because the low haze is the air
// nearest the eye. Written out, a surface comes back as
//
//     colour * (1 - f) * (1 - g)  +  A(d) * f * (1 - g)  +  fog * g
//
// with f the per channel distance fraction, g the capped low haze, and A the
// turning colour. airTerms() hands back the two pieces of that so a program can
// carry them from a vertex shader if it wants to.
export const FOG_GLSL = /* glsl */`
  uniform vec3 uFogColour;
  uniform float uFogDensity;
  uniform float uFogHeight;
  uniform float uEyeHeight;
  uniform vec3 uAirBeta;
  uniform vec3 uAirNear;
  uniform vec3 uAirPale;
  uniform vec2 uAirLaw;

  // Mean density along a ray that climbs from the eye to the fragment, for a
  // density that falls exponentially with altitude. The difference of the two
  // exponentials is the closed form of the integral; the limit is taken by hand
  // when the ray is level, where that difference cancels.
  //
  // SHARED BY BOTH TERMS, and that is the point of taking it out: the low haze
  // and the distance stand in the same air, so a hilltop has to be thinner in
  // both by the same profile or the join between them is a colour.
  float airMean(float fragmentHeight) {
    float dy = fragmentHeight - uEyeHeight;
    float a = exp(-max(uEyeHeight, 0.0) / uFogHeight);
    float b = exp(-max(fragmentHeight, 0.0) / uFogHeight);
    return abs(dy) < 0.01 ? a : (a - b) * uFogHeight / dy;
  }

  // The low haze: E-LUCE2's own term, at E-LUCE2's own density, with a ceiling.
  float fogAmount(float distance, float fragmentHeight) {
    float depth = distance * uFogDensity * airMean(fragmentHeight);
    return min(uAirLaw.x, 1.0 - exp(-depth * depth));
  }

  // The distance, per channel: Beer-Lambert over the path BEYOND the origin.
  //
  // uAirLaw.y is that origin, in metres of optical path, and it is where the
  // reference's near flank stands. Nearer than it this term is exactly nothing,
  // because the air of those metres is already inside the pigment the cornice's
  // palette was solved to. See AIR_PATH_ORIGIN.
  vec3 airVeil(float distance, float fragmentHeight) {
    float path = max(distance * airMean(fragmentHeight) - uAirLaw.y, 0.0);
    return 1.0 - exp(-uAirBeta * path);
  }

  // And the colour it goes out into, from the low sky's blue to the pale veil.
  //
  // The blue is light scattered once and the pale veil is light scattered more
  // than once, so the weight of the second is the square of the first. There is
  // no length here and nothing fitted: it is the veil this same air already
  // computed, squared.
  vec3 airTint(vec3 veil) {
    return mix(uAirNear, uAirPale, veil.g * veil.g);
  }

  // What is kept of the surface and what is added in front of it, per channel.
  void airTerms(float distance, float fragmentHeight, out vec3 keep, out vec3 add) {
    vec3 f = airVeil(distance, fragmentHeight);
    float g = fogAmount(distance, fragmentHeight);
    keep = (1.0 - f) * (1.0 - g);
    add = airTint(f) * f * (1.0 - g) + uFogColour * g;
  }

  // The whole of it, for the programs that have the fragment's own distance.
  vec3 throughAir(vec3 colour, float distance, float fragmentHeight) {
    vec3 keep;
    vec3 add;
    airTerms(distance, fragmentHeight, keep, add);
    return colour * keep + add;
  }
`;

// HOW A TEXEL OF A BAKED ATLAS IS UNPACKED. Part two, and it dies with the
// atlases: what is stored is a bake, and a face of the voxel world computes its
// two terms instead of fetching them.
//
// It is one seat and not one copy per material because it is a STORAGE FORMAT
// and not a taste. The sun term is grey in rgb, which the sampler brings back
// to linear light on its own; the sky term is in ALPHA, which carries no
// transfer at all, as the square root of its linear value — tools that no
// longer exist put it there because an ETC1S block holds one coarse chroma and
// a shadow edge is exactly where the two terms disagree, so the old
// red-and-green pair cost 16.67 levels on every edge against 4.14 this way.
// Four materials read these atlases and all four have to unpack them the same
// way; bakedLight() in src/core/sky.js is what says what the pair MEANS, and
// this only says how one is fetched.
//
// AND IT IS ONE TAP. There used to be a cubic B-spline over four bilinear taps
// here, and it existed for one measured defect: a shadow edge in the delivered
// ground atlas is 1.65 texels wide at the median, so bilinear rebuilt it as a
// staircase on the texel grid, and at the near ground one of those steps
// covered tens of screen pixels. That defect belongs to the atlas, and the
// atlas is going: a face of the voxel world is lit by an analytic term on a
// constant normal, which has no texel grid to show through and nothing to
// reconstruct between samples. Keeping a four tap filter for a picture with no
// texels in it would be paying the fill for a defect that cannot occur.
export const BAKED_TERMS_GLSL = /* glsl */`
  vec3 bakedTerms(sampler2D tex, vec2 uv) {
    vec4 s = texture2D(tex, uv);
    return vec3(s.r, s.a * s.a, s.a * s.a);
  }
`;

const TERRAIN_VERTEX = /* glsl */`
  varying vec2 vUv;
  varying float vDistance;
  varying float vHeight;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vHeight = world.y;
    vDistance = length(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// WHAT WAS BETWEEN HERE AND THE FRAGMENT SHADER, AND WHY IT IS NOT.
//
// THREE HUNDRED AND FIFTY LINES OF TWO TERMS THAT NOTHING COULD REACH. DETAIL
// was the grit and the bedded stones of the paving under the walker's own feet,
// repeated over the world out of a two channel tile because the ground atlas
// could not write a three centimetre stone at any amplitude. STRIP was the
// joints of that paving as a DISTANCE rather than as a picture of them, so the
// frame could draw an edge finer than the texel that told it where the edge
// was. Both were measured, both were argued, and both were correct.
//
// AND NEITHER WAS EVER REACHED. The only surface that ever passed `detail` or
// `strip` to createBakedMaterial was the bent grid of src/world/terrain.js;
// that mesh was deleted at step 7, and the corridor has been columns of V1's
// disc with a material of its own since step 4. Step 7 declared the two inert
// where they stood rather than taking them, because this file is the
// coordinator's PART TWO -- parked, not frozen -- and the retirement belonged
// to whoever took the baked surface out of here.
//
// STEP 8 IS THAT DAY, and the two maps they read went with it: terrain-detail
// and terrain-path left the delivery in the same hour, with terrain-albedo and
// terrain-light beside them. A branch with no caller, reading a map that is no
// longer built, from a source that is no longer in the repository, is not a
// spare. What survives of the argument is where it is now made: the corridor's
// own lattice and its three maps are src/world/path.js and tools/path/
// paint-path.mjs, and the joint solved as a position rather than drawn as a
// picture is src/world/voxel/material.js.
//
// STRIP_REACH came here from src/world/path-strip.js at step 7 for the shader
// that was the only thing left reading it. Nothing reads it now. What is left
// in this file is the AIR, which is frozen, and the baked material with the two
// maps it always had: an albedo and a light.

const TERRAIN_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  varying float vDistance;
  varying float vHeight;

  uniform sampler2D tAlbedo;
  uniform sampler2D tLight;
  uniform float uLightScale;
  ${SCENE_LIGHT_GLSL}
  ${BAKED_TERMS_GLSL}
  ${FOG_GLSL}

  void main() {
    // Both textures carry an sRGB transfer function, so the sampler has already
    // brought them back to linear light by the time they arrive here.
    vec3 albedo = texture2D(tAlbedo, vUv).rgb;

    // Red is how much of the sun this texel sees, green how much of the sky,
    // each stored divided down to fit eight bits.
    //
    // ONE TAP, and it used to be four: see the note over BAKED_TERMS_GLSL for
    // why the cubic reconstruction went with the atlas it was reconstructing.
    vec3 terms = bakedTerms(tLight, vUv);

    // Where the pair becomes light again -- and where an evening would become a
    // different light off the same two numbers.
    vec3 light = bakedLight(terms) * uLightScale;

    vec3 colour = albedo * light;
    colour = throughAir(colour, vDistance, vHeight);
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
export function createBakedMaterial({ albedo, light, lightScale }) {
  return new ShaderMaterial({
    uniforms: {
      tAlbedo: { value: albedo },
      tLight: { value: light },
      uLightScale: { value: lightScale * GROUND_EXPOSURE },
      ...SCENE_LIGHT_UNIFORMS,
      ...fogUniforms(),
    },
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: TERRAIN_FRAGMENT,
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
  uAirPale: { value: new Vector3(...AIR_PALE) },
  uEyeHeight: { value: 1.7 },
};
const AIR_PER_SKY = new Vector3(...FOG_RADIANCE).divide(
  new Vector3().copy(SCENE_LIGHT_UNIFORMS.uSkyLight.value),
);
// The pale end of the distance is kept the same way and for the same reason: as
// a RATIO to the light the sky is handing the ground, so a different hour moves
// the far veil with the sky instead of leaving it at noon. The near end needs no
// ratio — it is the ramp itself, read at the door in src/core/sky.js.
const PALE_PER_SKY = new Vector3(...AIR_PALE).divide(
  new Vector3().copy(SCENE_LIGHT_UNIFORMS.uSkyLight.value),
);

// Il cielo com'era l'ultima volta che l'aria l'ha guardato. Un NaN di
// partenza, cosi' che il primo confronto non sia mai uguale e la prima
// chiamata scriva comunque.
const skyWas = new Vector3(NaN, NaN, NaN);

/**
 * Tells the air where the eye is, and what hour it is.
 *
 * Called once a frame from the hub, which is the one place that knows both.
 *
 * @param {number} eyeHeight  metres above the world's zero
 */
export function setAir(eyeHeight) {
  AIR.uEyeHeight.value = eyeHeight;
  // E IL COLORE DELL'ARIA SI RIFA' QUANDO IL CIELO SI MUOVE, CHE NON E' A OGNI
  // FOTOGRAMMA (U-PERF-7).
  //
  // L'altezza dell'occhio cambia a ogni respiro ed e' giusto che questa riga la
  // scriva sempre. Le due righe sotto invece sono funzioni di `uSkyLight` e di
  // nient'altro, e `uSkyLight` si muove quando si muove l'ORA -- un preset, una
  // sera, mai un fotogramma. Erano due copie e due moltiplicazioni di Vector3
  // per fotogramma per un valore che stava fermo per minuti.
  const sky = SCENE_LIGHT_UNIFORMS.uSkyLight.value;
  if (sky.x !== skyWas.x || sky.y !== skyWas.y || sky.z !== skyWas.z) {
    skyWas.copy(sky);
    AIR.uFogColour.value.copy(sky).multiply(AIR_PER_SKY);
    AIR.uAirPale.value.copy(sky).multiply(PALE_PER_SKY);
  }
  return AIR;
}

export function fogUniforms() {
  return {
    // Shared by reference, not copied: see AIR above.
    uFogColour: AIR.uFogColour,
    uFogDensity: { value: HEIGHT_FOG.densityAtGround },
    uFogHeight: { value: HEIGHT_FOG.scaleHeight },
    uEyeHeight: AIR.uEyeHeight,
    // The three of the distance. `uAirNear` is the SKY'S OWN OBJECT, shared by
    // reference and never copied, for the reason the sun is: there is one ramp
    // in this world, and a material holding its own blue is a material still
    // drawing noon after the preset has moved.
    uAirBeta: { value: new Vector3(...AIR_BETA) },
    uAirNear: AIR_NEAR_UNIFORM,
    uAirPale: AIR.uAirPale,
    // The ceiling on the low haze and the origin of the distance's path: the
    // two numbers of the LAW, as against the colours it runs between.
    uAirLaw: { value: new Vector2(FOG_LOW_CAP, AIR_PATH_ORIGIN) },
  };
}

// One object, so that every material's `uAirNear` is the same Vector3 the door
// in src/core/sky.js writes when a preset arrives.
const AIR_NEAR_UNIFORM = { value: AIR_NEAR };
