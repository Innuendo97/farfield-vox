import { agx } from './agx.mjs';
import { agxInverse } from './agx-inverse.mjs';
import { linearToSrgb, srgbToLinear } from './color.mjs';
import { FRAME, makeRay } from './framing.mjs';

// Where the sun is, and what the clear sky does everywhere the reference does
// not reach.
//
// The reference shows one twentieth of the hemisphere, so anything outside it
// is extrapolation, and the shape of the extrapolation decides whether the sky
// reads as sky. Two things are therefore built here rather than fitted freely.
//
// The sun is measured, not chosen. Three independent readings of the reference
// agree on it: every monolith face the framing shows points somewhere between
// south east and south west and every one of them is in shadow, which puts the
// sun in the northern half; the clear sky brightens towards one azimuth and
// falls away either side of it; and it loses its blue towards the same place,
// because forward scattering by aerosol whitens the sky around the sun. The
// disc itself is not in the framing, so the elevation is bounded below by the
// top of it and settled by the fit.
//
// The clear sky is single scattering by air and aerosol, not a curve per
// channel. Three exponentials with free channels were what put a green ring
// round the horizon: nothing stops three independent fits from crossing, and
// two degrees below the lowest measured sample they did. Rayleigh and Mie
// cannot cross. The hue is not a parameter here — it comes out of the
// wavelength dependence and the airmass, so the horizon is pale blue because
// that is the only thing this model can produce, and the zenith is deep blue
// for the same reason.

const DEG = Math.PI / 180;

// Channel wavelengths, nanometres: sRGB primaries at their perceptual centres.
const LAMBDA = [630, 532, 465];
const RAYLEIGH_POWER = 4;
// Angstrom exponent of a continental haze. Aerosol scatters almost neutrally,
// which is what lets the sky whiten towards the sun instead of turning warm.
const MIE_POWER = 1.3;

const rayleighScale = LAMBDA.map((l) => (550 / l) ** RAYLEIGH_POWER);
const mieScale = LAMBDA.map((l) => (550 / l) ** MIE_POWER);

// The fit is bounded, and the bounds are not cosmetic.
//
// Rayleigh optical depth at 550 nm is 0.097 at sea level: it is a property of
// air, not of the picture, and it is allowed to move by a factor of two either
// way and no further. Left free the fit walks it to zero, because a vanishing
// optical depth makes brightness proportional to air mass and that fits the
// twenty four degrees of sky the reference shows slightly better than anything
// physical does — at the price of a zenith thirty five times darker than the
// horizon, which is to say black. That is the same failure as the green ring,
// arriving from the other end of the sky.
//
// The multiple scattering term is bounded tightly for the opposite reason. It
// is the only isotropic thing in the model, so a fit allowed to lean on it will:
// it explains the average of the sector for free and leaves the sky flat across
// the azimuth, where the reference falls by a factor of four from the brightest
// bearing to the edges of the framing. That fall is the solar lobe, and the
// solar lobe is what the whole far field is going to be lit by.
const BOUNDS = {
  tR: [0.05, 0.22],
  tM: [0.008, 0.45],
  g: [0.55, 0.88],
  ambient: [0, 1.1],
  // And the two lobes of the circumsolar peak, which are bounded below at
  // nothing rather than at a value: a fit that wants no aureole is a fit that
  // says this haze has no sharp forward peak, and that is an answer.
  aureoleWide: [0, 0.8],
  aureoleNarrow: [0, 4],
};

const kastenYoung = (z) => 1 / (Math.cos(z * DEG) + 0.50572 * (96.07995 - z) ** -1.6364);

// How far below the horizon the air mass keeps growing before it settles.
// Small, because nothing below the horizon is meant to be looked at; the only
// job here is to arrive there with the slope the sky had above.
const BELOW_HORIZON_TAU = 1.5;
const HORIZON_MASS = kastenYoung(90);
const HORIZON_MASS_SLOPE = (kastenYoung(90) - kastenYoung(89.5)) / 0.5;

/**
 * Kasten and Young relative air mass; finite at the horizon, unlike 1/cos, and
 * continued below it with the slope it arrives with.
 *
 * Clamping it at the horizon instead is what drew a line across the equator of
 * the whole texture: above the horizon the sky falls by three or four levels
 * every half degree and below it, clamped, it falls by nothing. The value
 * matched across the join and the slope did not, and a slope that changes in
 * one row is a crease the eye finds immediately — on the one row a walker
 * looking straight ahead has in the middle of the frame.
 */
export function airMass(zenithDeg) {
  const z = Math.max(0, zenithDeg);
  if (z <= 90) return kastenYoung(z);
  return HORIZON_MASS
    + HORIZON_MASS_SLOPE * BELOW_HORIZON_TAU * (1 - Math.exp(-(z - 90) / BELOW_HORIZON_TAU));
}

function rayleighPhase(cosGamma) {
  return (3 / (16 * Math.PI)) * (1 + cosGamma * cosGamma);
}

function miePhase(cosGamma, g) {
  const d = 1 + g * g - 2 * g * cosGamma;
  return ((1 - g * g) / (4 * Math.PI)) / Math.max(1e-4, d ** 1.5);
}

// The exponents of the circumsolar peak, which are the canon's and not fitted.
//
// One Henyey-Greenstein term is a poor description of an aerosol very near the
// forward direction: a real haze has a peak an order of magnitude sharper than
// any single asymmetry can produce, and that peak is the aureole. So a wide and
// a narrow forward term are added to the SAME Mie coefficient — a correction to
// the phase function rather than a light of its own, so they carry the haze's
// wavelength dependence and the haze's air mass and can invent neither a colour
// nor a horizon.
//
// The exponents come from the original project's own reading of the canon
// (src/scenes/sky.ts, section 2): cos^8 and cos^40, the second with a half
// width of about ten degrees. THE AMPLITUDES DO NOT. They were taken from there
// too at first, and that was wrong twice over: they are weights of a mix in
// display space rather than of a phase function, and this model has already
// been FITTED to this reference, so anything laid on top of it double counts
// what the fit has already explained. Measured, it made the sky above the
// framing forty per cent brighter than the photograph it was fitted to, and it
// steepened the sky around the sun enough that the cloud bake's own completion
// began to show its seams. So the amplitudes are searched with the rest of the
// model, against the sky between the reference's clouds, and what comes back is
// what this photograph's own haze does.
export const AUREOLE_WIDE_EXPONENT = 8;
export const AUREOLE_NARROW_EXPONENT = 40;

/** The circumsolar peak, as a correction to the aerosol's phase function. */
export function aureolePhase(cosGamma, p, sharpness = 1) {
  const forward = Math.max(0, cosGamma);
  const peak = AUREOLE_NARROW_EXPONENT * sharpness;
  // Shortened and dimmed together: a lobe of cos^n integrates to 2*pi/(n+1), so
  // spreading one without taking its peak down makes light rather than moving
  // it about.
  return (p.aureoleWide || 0) * forward ** AUREOLE_WIDE_EXPONENT
    + (p.aureoleNarrow || 0) * ((peak + 1) / (AUREOLE_NARROW_EXPONENT + 1))
      * forward ** peak;
}

/**
 * Clear sky radiance for one direction.
 * @param {object} p  fitted parameters
 * @param {number} elevationDeg
 * @param {number} cosGamma  cosine of the angle between the ray and the sun
 */
export function clearSkyRadiance(
  p, elevationDeg, cosGamma, out = [0, 0, 0], bearingDeg = null, azimuthDeg = null,
) {
  const m = airMass(90 - elevationDeg);
  const pr = rayleighPhase(cosGamma);
  const pm = miePhase(cosGamma, p.g);
  const aureole = aureolePhase(cosGamma, p);
  const shape = p.shape
    ? tableAt(p.shape, elevationDeg,
      bearingDeg === null ? Math.acos(Math.max(-1, Math.min(1, cosGamma))) / DEG : bearingDeg)
    : 1;
  const local = p.residual && azimuthDeg !== null
    ? residualAt(p.residual, elevationDeg, azimuthDeg)
    : null;
  for (let c = 0; c < 3; c++) {
    const tr = p.tauRayleigh * rayleighScale[c];
    const tm = p.tauMie * mieScale[c];
    const tau = tr + tm;
    // Single scattering along the ray, plus an isotropic term standing in for
    // everything scattered more than once. Both are attenuated by the same
    // optical depth, so the horizon saturates instead of running away.
    const source = (tr * pr + tm * (pm + aureole) + p.ambient * tau / (4 * Math.PI)) / tau;
    out[c] = p.exposure[c] * source * (1 - Math.exp(-tau * m)) * shape;
    if (local) out[c] *= local[c];
  }
  return out;
}

// The one place the model is allowed to be told it is wrong.
//
// Single scattering under one aerosol gets the hue of a sky right and the rest
// of it only roughly, and the reference is an illustration, not a photometer.
// So a scalar correction is read off it — one number for the three channels, so
// it can brighten or dim a piece of sky and can never tint one. The hue stays
// whatever Rayleigh and Mie say it is, which is the whole reason for using them.
//
// The correction is a surface over height and bearing from the sun, not a curve
// over either alone. It was tried as two curves and that is not what the sky
// does: high up the reference falls by a factor of four from the bearing of the
// sun to the edge of the framing, and along the horizon it barely falls at all,
// because down there the haze is the same in every direction. One curve against
// the angle to the sun has to average those two behaviours together and ends up
// describing neither, which left the sky above the top corners of the framing
// half again as bright as the reference — a bright band drawn along exactly the
// edge of the frame the reference pose shows.
//
// Outside the range the reference covers it is held at the last value measured
// rather than continued. A curve continued past its data is what put a green
// ring round this horizon before, and holding it flat past the widest bearing
// the framing reaches is also right: away from the sun the sky stops caring
// where the sun is.
const HEIGHT_LO = -90;
const HEIGHT_HI = 90;
const HEIGHT_STEP = 3;
const BEARING_STEP = 6;
const HEIGHT_CELLS = Math.round((HEIGHT_HI - HEIGHT_LO) / HEIGHT_STEP) + 1;
const BEARING_CELLS = Math.round(180 / BEARING_STEP) + 1;

function relativeBearing(azimuth, sunAzimuth) {
  let d = azimuth - sunAzimuth;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return Math.abs(d);
}

// Smooth in the fraction, not linear in it.
//
// A table read bilinearly is continuous and its slope is not: the slope jumps
// at every cell boundary, and a correction that carries a real gradient shows
// each of those jumps as a crease. Three degrees apart, they read as horizontal
// lines ruled across the sky — there was one at twenty one degrees, which is a
// cell boundary of this very table. Easing the fraction makes the surface C1,
// and costs two multiplies.
const ease = (t) => t * t * (3 - 2 * t);

function tableAt(table, elevationDeg, bearingDeg) {
  const fy = Math.min(HEIGHT_CELLS - 1.001, Math.max(0,
    (Math.min(HEIGHT_HI, Math.max(HEIGHT_LO, elevationDeg)) - HEIGHT_LO) / HEIGHT_STEP));
  const fx = Math.min(BEARING_CELLS - 1.001, Math.max(0,
    Math.min(180, Math.max(0, bearingDeg)) / BEARING_STEP));
  const y0 = fy | 0; const x0 = fx | 0;
  const ty = ease(fy - y0); const tx = ease(fx - x0);
  const at = (y, x) => table[y * BEARING_CELLS + x];
  return (at(y0, x0) * (1 - tx) + at(y0, x0 + 1) * tx) * (1 - ty)
    + (at(y0 + 1, x0) * (1 - tx) + at(y0 + 1, x0 + 1) * tx) * ty;
}

// ------------------------------------------------ the residual, where it lies
//
// What is left of the reference once the model and its bearing surface have
// said everything they can say, kept as a function of the signed bearing rather
// than of the angle to the sun.
//
// That distinction is the whole point. The surface above is symmetric about the
// sun by construction, so it has to average the two sides of it together; and
// this reference is not symmetric — twenty five degrees left of the sun it is a
// long way darker and greyer than twenty five degrees right of it. Averaged,
// the built sky beside the photographed sector was neither, and the sector
// therefore had a rim: a band of sky along its edge that did not continue it.
//
// So the difference is measured where the reference reaches, carried outwards
// on a broad kernel, and faded to unity over about thirty degrees of bearing
// and fifteen of height. Adjacent to the sector it is the measurement exactly,
// which is what removes the rim; far from it the physical model is back, which
// is what stops a measurement made over seventy degrees of sky from deciding
// what the other two hundred and ninety look like.
//
// It is allowed a hue, unlike the surface above, because a hue is what the rim
// was made of. It is not allowed much of one: the departure of any channel from
// the mean of the three is clamped, so the correction can shift the sky towards
// grey or towards blue and can never invent a colour the sky does not have.
//
// And it is carried a short way, because what it carries is not weather.
//
// The reference darkens its own upper left corner by more than half, and that
// darkening is the illustration's, not the sky's: nothing physical puts a soft
// grey pit forty degrees wide in a clear sky and nothing else in the frame casts
// it. Carried far, it becomes exactly that — a structureless dark mass standing
// in the deep blue above the framing with crisp cumulus all round it and none of
// it over it, which the eye reads as smoke long before it reads it as sky. So
// the carry is given one job and no more: to arrive at the edge of the framing
// with the value the reference has there, and to be gone a few degrees later.
// The reach is a true angle from the measurement rather than an ellipse over the
// two axes, so it is the distance from the edge that decides how much is left
// and never the direction, and the hue lets go sooner than the level does — a
// dimming that keeps the sky's own blue reads as haze, and the same dimming with
// the corner's grey in it reads as a stain.
//
// How far it reaches depends on the height, because a wash does not read the
// same way at every one. Low down the sky is haze, a broad soft gradient is what
// haze is made of, and the correction can take its time letting go without
// anything being visible — where it has to take its time, because the edge of
// the framing down there is four degrees of dead straight vertical and a
// correction that turns round along it draws it. Above the top of the framing
// the sky is deep blue and empty: nothing soft up there has a scale, and the
// same gradient becomes a stain hanging in the blue. So the reach is long at the
// horizon, short above the framing, and the sky is the model's again a few
// degrees past the corner.
// The grid it lives on is half what it was across the bearing, because four
// degrees is wider than the thing that has to be read. The reference's own edge
// shading falls away over about three degrees of bearing at the left boundary of
// the framing, and a grid whose nearest node is two degrees inside that boundary
// cannot put a value on the boundary at all: it interpolates across it, and the
// built sky beside the darkest sky in the reference comes out a long way lighter
// than it. Halved, there is a node on the boundary itself.
const RES_EL_LO = -24;
const RES_EL_HI = 90;
const RES_EL_STEP = 2;
const RES_AZ_LO = -104;
const RES_AZ_HI = 104;
const RES_AZ_STEP = 2;
const RES_EL_CELLS = Math.round((RES_EL_HI - RES_EL_LO) / RES_EL_STEP) + 1;
const RES_AZ_CELLS = Math.round((RES_AZ_HI - RES_AZ_LO) / RES_AZ_STEP) + 1;

// Reach of the carry, and of the fade back to the model, in degrees.
//
// The carry is the kernel the measurement is read through, and it was wider than
// the thing it had to read. Along the left boundary of the framing the reference
// falls by a third over three degrees — that fall is the illustration's own edge
// shading, and inside the framing it is kept, because inside the framing every
// pixel is kept. A kernel seven degrees wide cannot follow a ramp three degrees
// long: it hands back the sky averaged over ten degrees of bearing, which is far
// lighter, and the built sky therefore arrives beside the measurement thirty
// levels above it. Thirty levels across the boundary of the framing is a step,
// the boundary of the framing is four degrees of dead straight vertical, and a
// straight step with the darkest sky in the reference on one side of it is the
// upright flank the whole quadrant was failed for.
//
// So the kernel is brought down to the spacing of the cells it reads — one cell
// across in bearing, one in height — which is the narrowest it can be and still
// average two readings together. What was a step is then a ramp: the built sky
// leaves the boundary at the value the reference has there and lets go of it
// over the reach below, and the reach wanders, so nothing about the going is
// straight either.
// Narrow across the bearing and no narrower than it was up the sky. What has to
// be followed is a vertical edge, so it is the bearing that needs the resolution;
// tightening the height as well only sharpened the cell to cell steps of a grid
// whose rows are two degrees apart, and those read as horizontal ripples at
// twenty degrees, which is where the sky has least to hide them.
const RES_CARRY_AZ = 2.5;
const RES_CARRY_EL = 3.5;
const RES_FADE_LOW = 20;
const RES_FADE_HIGH = 8;
const RES_FADE_FROM = 8;
const RES_FADE_TO = 26;
// What the hue keeps of the reach the level gets.
const RES_CHROMA_REACH = 0.4;

// The level goes out on two scales, and only one of them has a shape.
//
// Everything above is one carry with one reach, and a single reach is what drew
// the mass. Full at the boundary and gone a dozen degrees later, the correction
// has a contour; the contour is an offset of the boundary of the measurement;
// the boundary of the measurement is a photographic frame; and what stands
// inside that offset frame is the darkest sky in the reference. Wandering the
// reach bent the contour and did not remove it, because what the eye was
// reading was never the straightness — it was that the sky came back to the
// model inside the width of the thing that was standing in it. A darkening
// fifty levels deep and fifteen degrees wide is a mass whatever its outline.
//
// So the level is split. The broad part of it — the measurement read through a
// kernel wide enough that no edge of the framing survives in it — is carried
// out over tens of degrees, and it has no shape of its own to draw: it is one
// smooth number falling away across the whole western sky. The departure from
// that broad part is what carries the reference's own edge shading, and that
// still travels only as far as it did, because it is the thing that has to
// arrive at the boundary exactly and it is also the thing that would read as a
// stain if it went any further.
//
// The reach is measured against what the reference itself does. Its own clear
// sky, at the height of the fault, falls by at most 5.4 display levels per
// degree of azimuth; the single carry let the built sky come back at 9.8, which
// is the sky recovering faster than it ever falls. Split and spread over this
// much bearing the steepest place on that side is 3.5, which is shallower than
// the gradient the reference is already made of — and a gradient shallower than
// the sky's own cannot be read as the edge of anything.
//
// Long across the bearing and short up the sky, because those are different
// questions. Sideways there is nothing to give a soft wide gradient a scale, so
// it reads as the sky being darker that way, which is what the reference says
// it is. Upwards the sky empties into deep blue within a few degrees of the top
// of the framing, and a wash carried up into that has crisp cumulus on every
// side of it and none of it over it — the one reading that is worse than a
// rectangle.
const TREND_REACH_AZ = 46;
const TREND_REACH_EL = 15;
// The kernel the broad level is read through: wider than the edge shading it
// must not carry, narrower than the framing it must not average whole. Read
// through a kernel the width of the sector, the level outside the left boundary
// comes back the mean of a sector whose other half is the brightest sky in the
// picture, and the reference's own darkening then has to be made up by the
// short carry all over again — the mass returns, half as deep. Read through one
// as narrow as the cell spacing it becomes nearest neighbour extrapolation, and
// the boundary readings differ enough from one to the next to draw spokes.
const TREND_CARRY_AZ = 7;
const TREND_CARRY_EL = 3.5;

const fadeReach = (elevationDeg) => RES_FADE_LOW
  + (RES_FADE_HIGH - RES_FADE_LOW)
  * ease(Math.min(1, Math.max(0, (elevationDeg - RES_FADE_FROM) / (RES_FADE_TO - RES_FADE_FROM))));

// How far the carry reaches, pushed in and out by a field of its own.
//
// Everything above decides how deep the correction is and how long it takes to
// let go. Nothing above decides what shape it lets go in, and that turned out to
// be the only thing about it the eye reads. The reach is a distance from the
// measurement, so a contour of constant reach is an offset of the boundary of
// the measurement — and that boundary is a photographic frame: two dead straight
// verticals and a dead straight top. Offset outwards by a dozen degrees it is
// still two verticals and a top, and what stands inside it is the darkest sky in
// the reference. A dark rectangle with a flat shoulder and upright flanks, in a
// clear sky, is a monolith seen in negative, and it was read as one.
//
// Shortening the reach only draws it more sharply — that was tried, and the mass
// simply traced the corner of the framing instead of a dozen degrees outside it.
// Lengthening it makes the same shape bigger. So the reach is given a wander
// instead: a smooth field over bearing and height, at the scale of the weather
// around it, which pushes the contour several degrees in and out along its own
// length. It says nothing new about where the wash ends, because nothing is
// known about that; it takes away the one property that made it legible, which
// is that the answer was the same distance out everywhere.
//
// Two products of sines, at lengths that do not divide one another, so the field
// does not repeat over the sphere and has no straight level set of its own. It
// is bounded to one either way by construction, and it is smooth, so the
// correction it shapes gains no crease anywhere.
const REACH_WANDER = 0.42;
const reachWander = (elevationDeg, azimuthDeg) => (
  0.55 * Math.sin(azimuthDeg / 9.7 + 0.7) * Math.cos(elevationDeg / 6.3 + 1.9)
  + 0.45 * Math.sin(azimuthDeg / 5.1 - 2.2 + elevationDeg / 7.7)
);

// How far a single channel may depart from the mean of the three.
// The reference darkens its own left edge a long way further than any vignette
// the renderer applies, and the sector carries that darkening across pixel for
// pixel. The sky built beside it has to arrive at the same place or the edge of
// the sector is a step, so the correction is allowed to go down to a quarter of
// the model. What keeps that honest is the fade: a lobe this dark is a band
// along the edge a dozen degrees wide, and the physical sky is back.
const RES_CHROMA = 0.38;
const RES_RANGE = [0.12, 2.2];

// The correction may darken the sky it leaves behind. It may not brighten it.
//
// Everything above decides how the reading at the edge of the framing is
// carried outwards and how it lets go. All of it lets go by returning to the
// model, and the model out there is lighter than the reading was: at twenty one
// degrees of height the reference leaves its own left boundary at a fifth of
// the sky's brightness and the model beside it is at a half. So whatever shape
// the letting go is given, the level falls to the boundary and rises again a
// few degrees past it, and a level that falls and rises has a contour round it.
// That contour is the mass. It survived a narrower carry, a wider one, a
// wandering reach and a split into two scales, because none of them is about
// the direction the level moves in — they only change how fast it moves.
//
// So the level is held. Walking outwards from the last reading, in bearing or
// in height, the built sky may go on falling and may flatten, and may not climb
// back: each cell takes the lowest level anything between it and the
// measurement arrived at. There is then no contour to find, because there is no
// turn: the darkest place is the reference's own corner, which is where the
// picture actually is dark, and everything beyond it is the same or darker.
//
// Three numbers shape it. The bite comes in over the first few degrees rather
// than at the boundary itself, because the reading has its own slope there and
// a hold that starts with the slope already flat is a crease along four degrees
// of dead straight vertical. It keeps everything it took for as long as the
// wash is worth holding, and gives it back over the far side of the quadrant,
// where the model is what is left and nothing is being compared with anything.
// The giving back is spread wide enough that it is shallower than any gradient
// the reference itself is made of, and it happens only across the bearing: up
// the sky the model comes down to the held level on its own, so there is
// nothing to give back.
const HOLD_ONSET = 3;
const HOLD_FULL = 40;
const HOLD_RELEASE = 62;
// How near a reading a cell has to be to count as one of them.
const HOLD_SEED = 2;
// And how sharply the hold takes hold.
//
// Taking the lower of two numbers is not a smooth thing to do: where the falling
// level meets the held one the slope changes in a single cell, and a slope that
// changes in one cell is the same crease this whole file keeps having to avoid —
// it showed as a step at twenty degrees, which is where the corner of the
// framing is and where the sky has least to hide it. Rounded over a twentieth
// of a stop, the two meet as a curve. It costs the hold that much depth where
// nothing was being held anyway.
const HOLD_KNEE = 0.05;
const softFloor = (d) => (d < -20 * HOLD_KNEE ? d : -HOLD_KNEE * Math.log1p(Math.exp(-d / HOLD_KNEE)));

// What the reference leaves at the edge of its own framing.
//
// The hold sets off from the level the carry arrived at, and at the boundary
// that level is not the reading. A kernel two and a half degrees wide is a mean
// of everything inside it, and at the last row of readings there is nothing
// outside to balance what is inside, so the estimate leans inwards by however
// much the sky is falling. Down the left boundary the sky falls slowly and the
// lean is a level or two; down the right one it falls seventeen levels in a
// degree into the corner, and the carry comes back more than twenty above the
// picture's own last texels. Held from there, the built sky steps up where the
// photograph steps down, and a level that falls to the boundary and climbs
// across it has a contour round it — the same contour, and the same mass, the
// hold exists to prevent.
//
// So the level the walks set off with is read again, through a kernel narrow
// enough to follow that fall. Only the walks use it. Inside the framing the
// correction stays the measurement read the way it always was, because a kernel
// this narrow is close to the spacing of the readings themselves and carries
// their scatter, and scatter in the correction is ripples in the sky.
//
// It is smoothed along the boundary and not across it. A boundary reading is
// the one number a whole side of the far field is anchored to, and the corner
// of a photographic frame is where it is least trustworthy: the smallest sliver
// of picture, the largest lens shading, and the steepest thing in the sector all
// at once. The clear sky does not step, so neither may what is read off it.
const RIM_CARRY_AZ = 1.2;
const RIM_CARRY_EL = 1.2;
const RIM_SMOOTH = 2.5;

const displayLuma = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];

/** Scene radiance as the composite pass encodes it, without the grade. */
function encoded(radiance, out) {
  const tone = agx(radiance, 1);
  for (let c = 0; c < 3; c++) out[c] = linearToSrgb(Math.min(1, Math.max(0, tone[c])));
  return out;
}

// What colour a sky this dark is allowed to be.
//
// A correction that scales radiance keeps the hue it found in light and loses
// it on the way through the tone curve: the curve compresses towards its toe,
// so the same sky dimmed by half comes out with half the blue in it and reads
// warm — which is the brown the mass was made of, and it is arithmetic rather
// than weather. The model already knows what a darker sky looks like, because
// it has one: its own, further round from the sun, where there is less aerosol
// light in the line of sight and what is left is bluer. So the level decides
// how dark, and the bearing at which the model is that dark decides the hue.
// Past the darkest bearing there is the hue is held, rather than continued into
// a blue the model never produces.
const HUE_BEARING_STEP = 6;

/** Display chroma of the clear sky along the bearing, at one height. */
function hueFamily(params, sun, elevationDeg) {
  const rgb = [0, 0, 0];
  const enc = [0, 0, 0];
  const rows = [];
  for (let bearing = 0; bearing <= 180; bearing += HUE_BEARING_STEP) {
    clearSkyAt(params, sun, elevationDeg, sun.azimuth + bearing, rgb);
    encoded(rgb, enc);
    const y = displayLuma(enc);
    if (y <= 1e-5) continue;
    rows.push({ y, bg: (enc[2] - enc[1]) / y, br: (enc[2] - enc[0]) / y });
  }
  return rows;
}

/** The hue the family carries where it is as bright as the wash leaves the sky. */
function hueAt(family, y) {
  if (!family.length) return null;
  for (let k = 1; k < family.length; k++) {
    const a = family[k - 1];
    const b = family[k];
    if ((a.y >= y && b.y <= y) || (a.y <= y && b.y >= y)) {
      const span = a.y - b.y;
      const t = Math.abs(span) < 1e-6 ? 0 : (a.y - y) / span;
      return { bg: a.bg + (b.bg - a.bg) * t, br: a.br + (b.br - a.br) * t };
    }
  }
  const first = family[0];
  const last = family[family.length - 1];
  return y > first.y ? { bg: first.bg, br: first.br } : { bg: last.bg, br: last.br };
}

function residualAt(table, elevationDeg, azimuthDeg) {
  let az = azimuthDeg;
  while (az > 180) az -= 360;
  while (az < -180) az += 360;
  if (az <= RES_AZ_LO || az >= RES_AZ_HI
    || elevationDeg <= RES_EL_LO || elevationDeg >= RES_EL_HI) return null;
  const fy = (elevationDeg - RES_EL_LO) / RES_EL_STEP;
  const fx = (az - RES_AZ_LO) / RES_AZ_STEP;
  const y0 = Math.min(RES_EL_CELLS - 2, fy | 0);
  const x0 = Math.min(RES_AZ_CELLS - 2, fx | 0);
  const ty = ease(fy - y0);
  const tx = ease(fx - x0);
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = table[(y0 * RES_AZ_CELLS + x0) * 3 + c];
    const b = table[(y0 * RES_AZ_CELLS + x0 + 1) * 3 + c];
    const d = table[((y0 + 1) * RES_AZ_CELLS + x0) * 3 + c];
    const e = table[((y0 + 1) * RES_AZ_CELLS + x0 + 1) * 3 + c];
    out[c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
  }
  return out;
}

/**
 * Reads that residual off the bins the fit was run on.
 * @returns {Float32Array} three ratios per cell of the height by bearing grid
 */
export function fitLocalResidual(bins, sun, params) {
  const out = [0, 0, 0];
  const measured = [];
  const cells = new Map();
  for (const b of bins) {
    clearSkyAt({ ...params, residual: null }, sun, b.elevation, b.azimuth, out);
    const key = `${Math.round(b.elevation / RES_EL_STEP)}|${Math.round(b.azimuth / RES_AZ_STEP)}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        elevation: Math.round(b.elevation / RES_EL_STEP) * RES_EL_STEP,
        azimuth: Math.round(b.azimuth / RES_AZ_STEP) * RES_AZ_STEP,
        n: 0,
        log: [0, 0, 0],
      };
      cells.set(key, cell);
    }
    for (let c = 0; c < 3; c++) {
      cell.log[c] += Math.log(Math.max(1e-6, b.radiance[c]) / Math.max(1e-6, out[c]));
    }
    cell.n++;
  }
  for (const cell of cells.values()) {
    if (cell.n < 1) continue;
    measured.push({
      elevation: cell.elevation,
      azimuth: cell.azimuth,
      log: cell.log.map((v) => v / cell.n),
    });
  }
  if (measured.length < 12) return { table: null, cells: measured.length };

  const plain = { ...params, residual: null };
  const count = RES_EL_CELLS * RES_AZ_CELLS;
  const table = new Float32Array(count * 3).fill(1);
  // Everything the two passes below need to know about a cell, kept rather than
  // written out, because the hold cannot be decided one cell at a time.
  const modelRgb = new Float64Array(count * 3);
  const modelLevel = new Float64Array(count);
  const level = new Float64Array(count);
  const meanAt = new Float64Array(count);
  const chromaAt = new Float64Array(count * 3);
  const chromaKeep = new Float64Array(count);
  const rimAt = new Float64Array(count).fill(Infinity);
  const nearestAt = new Float64Array(count).fill(Infinity);
  const sidewaysAt = new Float64Array(count).fill(Infinity);
  const touched = new Uint8Array(count);
  const held = new Uint8Array(count);
  // Which way the readings lie from a cell, so the hold can walk away from them
  // and never along them.
  const towards = new Float64Array(count * 2);
  const inward = [0, 0];
  const rgb = [0, 0, 0];
  for (let y = 0; y < RES_EL_CELLS; y++) {
    const elevation = RES_EL_LO + y * RES_EL_STEP;
    const flatReach = fadeReach(elevation);
    for (let x = 0; x < RES_AZ_CELLS; x++) {
      const azimuth = RES_AZ_LO + x * RES_AZ_STEP;
      const cell = y * RES_AZ_CELLS + x;
      clearSkyAt(plain, sun, elevation, azimuth, rgb);
      for (let c = 0; c < 3; c++) modelRgb[cell * 3 + c] = rgb[c];
      modelLevel[cell] = Math.log(Math.max(1e-9, displayLuma(rgb)));
      level[cell] = modelLevel[cell];
      const reach = flatReach * (1 + REACH_WANDER * reachWander(elevation, azimuth));
      // Bearings converge towards the zenith, so the separation of two bearings
      // is an arc and not a difference. Without the cosine the reach grows with
      // height, and the one place this correction must not reach is the deep
      // blue above the framing.
      const apart = (p) => [
        (azimuth - p.azimuth) * Math.cos((elevation + p.elevation) * 0.5 * DEG),
        elevation - p.elevation,
      ];
      let nearest = Infinity;
      // How far the nearest reading is across the bearing alone, which is the
      // one axis the hold gives back on.
      let sideways = Infinity;
      // The same distance in the metric the broad level lets go on, already
      // divided by its own reach, so one against unity is the edge of it.
      let adrift = Infinity;
      // And in the metric its kernel reads on, kept so the kernel can be
      // normalised against its own nearest reading. Forty six degrees out, a
      // gaussian nine degrees wide is at ten to the minus six of its peak, and
      // a guard against an underflow becomes a wall across the sky at whatever
      // bearing the exponent happens to reach it. Taking the nearest reading
      // out of every exponent is the same weighted mean and cannot underflow.
      let closest = Infinity;
      for (const p of measured) {
        const [dAz, dEl] = apart(p);
        const away = Math.hypot(dAz, dEl);
        if (away < nearest) { nearest = away; inward[0] = -dAz; inward[1] = -dEl; }
        if (Math.abs(azimuth - p.azimuth) < sideways) sideways = Math.abs(azimuth - p.azimuth);
        const wide = Math.hypot(dAz / TREND_REACH_AZ, dEl / TREND_REACH_EL);
        if (wide < adrift) adrift = wide;
        const far = Math.hypot(dAz / TREND_CARRY_AZ, dEl / TREND_CARRY_EL);
        if (far < closest) closest = far;
      }
      nearestAt[cell] = nearest;
      sidewaysAt[cell] = sideways;
      const span = Math.hypot(inward[0], inward[1]);
      if (span > 1e-6) {
        towards[cell * 2] = inward[0] / span;
        towards[cell * 2 + 1] = inward[1] / span;
      }
      if (nearest >= reach && adrift >= 1) continue;
      // The kernel opens where the readings thin out.
      //
      // A kernel narrow enough to follow the edge shading at the boundary of the
      // framing is also narrow enough to tell the two sides of a monolith apart,
      // and behind a monolith there is nothing between them: the cells in there
      // are five degrees from any reading, and read through a narrow kernel they
      // take whichever shoulder is nearer rather than the two together. What
      // comes back is a correction that changes across the gap — a correction
      // shaped like the stone, which is the one shape nothing here may have. So
      // the width is the wider of what the boundary needs and how far the
      // nearest reading actually is: tight where the sky was measured densely,
      // and no tighter than the gap anywhere else.
      //
      // Across the bearing only, and never wider than the kernel this whole
      // correction used to be read through. The gaps that matter are monoliths,
      // and a monolith is a gap in bearing; opened up the sky as well it reaches
      // over the vertical ramp, which is the one thing a wide kernel here must
      // never average, and the readings lowest down came back describing the sky
      // several degrees above them.
      const spreadAz = Math.min(9, Math.max(RES_CARRY_AZ, 1.6 * nearest));
      const spreadEl = RES_CARRY_EL;
      let weight = 0;
      let broad = 0;
      const acc = [0, 0, 0];
      let smooth = 0;
      let rimWeight = 0;
      let rimAcc = 0;
      for (const p of measured) {
        const [dAz, dEl] = apart(p);
        const carry = Math.hypot(dAz / spreadAz, dEl / spreadEl);
        const w = Math.exp(-0.5 * carry * carry);
        weight += w;
        for (let c = 0; c < 3; c++) acc[c] += w * p.log[c];
        const far = Math.hypot(dAz / TREND_CARRY_AZ, dEl / TREND_CARRY_EL);
        const u = Math.exp(-0.5 * (far * far - closest * closest));
        broad += u;
        smooth += u * (p.log[0] + p.log[1] + p.log[2]) / 3;
        const rim = Math.hypot(dAz / RIM_CARRY_AZ, dEl / RIM_CARRY_EL);
        const r = Math.exp(-0.5 * rim * rim);
        rimWeight += r;
        rimAcc += r * (p.log[0] + p.log[1] + p.log[2]) / 3;
      }
      if (weight <= 1e-8 || broad <= 1e-8) continue;
      if (rimWeight > 1e-8) rimAt[cell] = modelLevel[cell] + rimAcc / rimWeight;
      const keep = 1 - ease(Math.min(1, nearest / reach));
      const keepTrend = 1 - ease(Math.min(1, adrift));
      const keepChroma = 1 - ease(Math.min(1, nearest / (reach * RES_CHROMA_REACH)));
      const log = acc.map((v) => v / weight);
      // The broad level travels on its own reach; what is left of the reading
      // once the broad level is taken out of it travels on the short one. At
      // the measurement the two add back up to the reading exactly, which is
      // what keeps every texel the reference covers untouched.
      const trend = smooth / broad;
      const mean = trend * keepTrend
        + ((log[0] + log[1] + log[2]) / 3 - trend) * keep;
      const chroma = log.map((v) => keepChroma
        * Math.min(RES_CHROMA, Math.max(-RES_CHROMA, v - (log[0] + log[1] + log[2]) / 3)));
      // Green may lean towards red or towards blue and may not lead either of
      // them. The clear sky this multiplies always runs blue over green over
      // red, and a correction that let green out in front would be a correction
      // that could put a green ring round the horizon — which is the one
      // failure this whole model is shaped to make impossible.
      chroma[1] = Math.min(Math.max(chroma[1], Math.min(chroma[0], chroma[2])),
        Math.max(chroma[0], chroma[2]));
      meanAt[cell] = mean;
      for (let c = 0; c < 3; c++) chromaAt[cell * 3 + c] = chroma[c];
      chromaKeep[cell] = keepChroma;
      level[cell] = modelLevel[cell] + mean;
      touched[cell] = 1;
    }
  }

  // What lies between two readings.
  //
  // Nothing between them is held: in there the correction is the measurement and
  // the measurement is the answer. The gaps the monoliths leave are between them
  // too — they have readings on both shoulders, so a hold reading one shoulder
  // and carrying it across would flatten the sky behind the stone to whichever
  // shoulder happens to be darker.
  //
  // The outermost reading of a row is not between anything. It sits within a
  // couple of degrees of the boundary and just as often outside it, and left
  // unheld it is a band of the carry's own boundary estimate lying along the
  // edge of the picture — which is the estimate that leans inwards. The walks
  // therefore start at it rather than past it, and how much of the hold it takes
  // is left to the bite, which at a cell with a reading on top of it is nothing.
  const inside = new Uint8Array(count);
  for (let y = 0; y < RES_EL_CELLS; y++) {
    let lo = -1;
    let hi = -1;
    for (let x = 0; x < RES_AZ_CELLS; x++) {
      if (nearestAt[y * RES_AZ_CELLS + x] > HOLD_SEED) continue;
      if (lo < 0) lo = x;
      hi = x;
    }
    if (lo < 0) continue;
    for (let x = lo + 1; x <= hi - 1; x++) inside[y * RES_AZ_CELLS + x] = 1;
  }

  // The hold, walked outwards from the readings along the two axes the sky is
  // actually looked along.
  //
  // Across the bearing, every row starts at the reading nearest the sun and
  // takes the lowest level anything between there and here arrived at. Up the
  // sky, every column starts at the highest reading it has and does the same.
  // The two are run against each other until neither has anything left to take,
  // which is a few rounds: what one pass lowers, the other may then carry
  // further.
  //
  // Two axes rather than a distance, because a distance has no direction along
  // the top of the framing — every cell up there is the same one degree from a
  // reading — and a hold that reads its neighbours by distance alone walks
  // sideways along that edge and stands the reference's own dark corner over
  // the middle of the picture.
  //
  // Nothing is ever taken downwards. Below the framing the sky goes on
  // brightening into the haze, and down is the one direction where a level
  // climbing away from the measurement is the sky doing what skies do.
  // The ceiling each walk sets off with, gathered at the last reading it has and
  // then smoothed among its neighbours along the boundary.
  const rimRowE = new Float64Array(RES_EL_CELLS).fill(Infinity);
  const rimRowW = new Float64Array(RES_EL_CELLS).fill(Infinity);
  const rimCol = new Float64Array(RES_AZ_CELLS).fill(Infinity);
  {
    const rim = [];
    for (let y = 0; y < RES_EL_CELLS; y++) {
      let lo = -1;
      let hi = -1;
      for (let x = 0; x < RES_AZ_CELLS; x++) {
        if (nearestAt[y * RES_AZ_CELLS + x] > HOLD_SEED) continue;
        if (lo < 0) lo = x;
        hi = x;
      }
      if (lo < 0) continue;
      const elevation = RES_EL_LO + y * RES_EL_STEP;
      rim.push({
        elevation,
        azimuth: RES_AZ_LO + hi * RES_AZ_STEP,
        raw: rimAt[y * RES_AZ_CELLS + hi],
        side: rimRowE,
        at: y,
      });
      rim.push({
        elevation,
        azimuth: RES_AZ_LO + lo * RES_AZ_STEP,
        raw: rimAt[y * RES_AZ_CELLS + lo],
        side: rimRowW,
        at: y,
      });
    }
    for (let x = 0; x < RES_AZ_CELLS; x++) {
      let top = -1;
      for (let y = 0; y < RES_EL_CELLS; y++) {
        if (nearestAt[y * RES_AZ_CELLS + x] <= HOLD_SEED) top = y;
      }
      if (top < 0) continue;
      rim.push({
        elevation: RES_EL_LO + top * RES_EL_STEP,
        azimuth: RES_AZ_LO + x * RES_AZ_STEP,
        raw: rimAt[top * RES_AZ_CELLS + x],
        side: rimCol,
        at: x,
      });
    }
    for (const p of rim) {
      let weight = 0;
      let sum = 0;
      for (const q of rim) {
        if (!Number.isFinite(q.raw)) continue;
        const dAz = (p.azimuth - q.azimuth) * Math.cos((p.elevation + q.elevation) * 0.5 * DEG);
        const away = Math.hypot(dAz, p.elevation - q.elevation) / RIM_SMOOTH;
        const w = Math.exp(-0.5 * away * away);
        weight += w;
        sum += w * q.raw;
      }
      p.value = weight > 1e-8 ? sum / weight : p.raw;
    }
    for (const p of rim) p.side[p.at] = p.value;
  }
  // A walk starts at whichever of the two is darker. Where the carry already
  // arrives at the reading — which is most of the boundary — they are the same
  // number and nothing moves.
  const startAt = (cell, from, rim) => (Number.isFinite(rim) ? Math.min(from[cell], rim) : from[cell]);

  // Where a column that was never measured sets off from.
  //
  // A column outside the framing has no reading of its own, and it used to pick
  // the height at which it came nearest to one. That distance is an arc, so it
  // shrinks with height — two bearings converge towards the zenith — and the
  // nearest reading to a column far round the sky is therefore found higher and
  // higher up as the column goes further round. The height it settles on is a
  // whole cell at a time, and the moment it settles above the top of what the
  // readings seed, the walk sets off from sky nothing has darkened yet and
  // carries nothing at all.
  //
  // Both edges of the patch in the west are that one sentence. Forty six degrees
  // out the chosen height stepped from inside the seeded band to above it, and
  // the hold switched off in the width of one cell for every height above the
  // band: a dead straight vertical. West of it the band below was still held and
  // the sky above it was not: a dead straight horizontal along the top of the
  // band. A photograph's corner, drawn in the sky, at the one bearing where an
  // integer changed.
  //
  // So every column that has nothing of its own sets off from the top of the
  // seeded band — the same height for all of them, which is a height no bearing
  // can step across — and the sideways carry has already been through that row,
  // so what climbs out of it is the same wash the rows below are holding.
  let seedTop = -1;
  for (let y = 0; y < RES_EL_CELLS; y++) {
    for (let x = 0; x < RES_AZ_CELLS; x++) {
      if (nearestAt[y * RES_AZ_CELLS + x] <= HOLD_SEED) { seedTop = y; break; }
    }
  }

  // What the walks hand each other, and what is handed to the sky, are not the
  // same number.
  //
  // The walks compose: the sideways carry fills the rows the readings seed, and
  // the climb lifts what it finds at the top of them. Feeding the climb the
  // level after the release has been taken out of it means the release is
  // applied twice over — once where the row was, and again where the column
  // arrives — and since the release is only partial out there, the column sets
  // off above the row it stands on. That difference is a step along the top of
  // the seeded band, of exactly the depth the release had let go of.
  //
  // So the carry is composed at full depth, and the release is a weight laid
  // over the finished thing, once. Nothing inside the quadrant moves: there the
  // release is whole and the two are the same number.
  const carried = Float64Array.from(level);
  const effective = Float64Array.from(level);
  const bite = new Float64Array(count);
  const give = new Float64Array(count);
  const cap = new Float64Array(count);
  const taken = new Float64Array(count);
  for (let cell = 0; cell < count; cell++) {
    bite[cell] = ease(Math.min(1, nearestAt[cell] / HOLD_ONSET));
    give[cell] = 1 - ease(Math.min(1, Math.max(0,
      (sidewaysAt[cell] - HOLD_FULL) / (HOLD_RELEASE - HOLD_FULL))));
  }
  for (let round = 0; round < 6; round++) {
    cap.set(carried);
    taken.fill(Infinity);
    for (let y = 0; y < RES_EL_CELLS; y++) {
      let lo = -1;
      let hi = -1;
      for (let x = 0; x < RES_AZ_CELLS; x++) {
        const c = y * RES_AZ_CELLS + x;
        if (nearestAt[c] > HOLD_SEED) continue;
        if (lo < 0) lo = x;
        hi = x;
      }
      // A height with nothing read at it has nothing to carry sideways. Above
      // the framing the column below has already brought the wash up to it, and
      // below the framing there is no wash: the reference's own sky line is the
      // bottom of everything that was measured, and the rows under it are the
      // haze thickening into the ground, which is the sky doing what it does.
      if (lo < 0) continue;
      let run = startAt(y * RES_AZ_CELLS + lo, cap, rimRowW[y]);
      for (let x = lo; x >= 0; x--) {
        const c = y * RES_AZ_CELLS + x;
        run = Math.min(run, cap[c]);
        taken[c] = Math.min(taken[c], run);
      }
      run = startAt(y * RES_AZ_CELLS + hi, cap, rimRowE[y]);
      for (let x = hi; x < RES_AZ_CELLS; x++) {
        const c = y * RES_AZ_CELLS + x;
        run = Math.min(run, cap[c]);
        taken[c] = Math.min(taken[c], run);
      }
    }
    for (let x = 0; x < RES_AZ_CELLS; x++) {
      let top = -1;
      for (let y = 0; y < RES_EL_CELLS; y++) {
        if (nearestAt[y * RES_AZ_CELLS + x] <= HOLD_SEED) top = y;
      }
      if (top < 0) top = seedTop;
      if (top < 0) continue;
      let run = startAt(top * RES_AZ_CELLS + x, cap, rimCol[x]);
      for (let y = top; y < RES_EL_CELLS; y++) {
        const c = y * RES_AZ_CELLS + x;
        run = Math.min(run, cap[c]);
        taken[c] = Math.min(taken[c], run);
      }
    }
    for (let cell = 0; cell < count; cell++) {
      if (inside[cell] || !Number.isFinite(taken[cell])) continue;
      carried[cell] = level[cell] + bite[cell] * softFloor(taken[cell] - level[cell]);
    }
  }
  for (let cell = 0; cell < count; cell++) {
    if (inside[cell] || !Number.isFinite(taken[cell])) continue;
    const drop = bite[cell] * give[cell] * softFloor(taken[cell] - level[cell]);
    effective[cell] = level[cell] + drop;
    if (drop < -1e-9) held[cell] = 1;
  }

  // What the whole of it asks of each channel.
  //
  // The level is whatever the carry and the hold between them arrived at, and
  // the hue is the reference's own where the reference reaches and the model's
  // own family a few degrees later. Both are written as one ratio per channel,
  // because that is all the sampler downstream knows how to read.
  const family = new Map();
  const enc = [0, 0, 0];
  const want = [0, 0, 0];
  const lit = [0, 0, 0];
  const lock = [0, 0, 0];
  const scaled = [0, 0, 0];
  for (let cell = 0; cell < count; cell++) {
    if (!touched[cell] && !held[cell]) continue;
    const y = Math.floor(cell / RES_AZ_CELLS);
    const elevation = RES_EL_LO + y * RES_EL_STEP;
    const drop = effective[cell] - modelLevel[cell];
    const model = [modelRgb[cell * 3], modelRgb[cell * 3 + 1], modelRgb[cell * 3 + 2]];
    const keepChroma = chromaKeep[cell];
    const lockStrength = inside[cell] ? 0 : 1 - keepChroma;
    if (lockStrength > 1e-4) {
      if (!family.has(y)) family.set(y, hueFamily(plain, sun, elevation));
      for (let c = 0; c < 3; c++) scaled[c] = model[c] * Math.exp(drop);
      encoded(scaled, enc);
      const wanted = displayLuma(enc);
      const hue = hueAt(family.get(y), wanted);
      if (hue) {
        want[2] = wanted * (1 + 0.2126 * hue.br + 0.7152 * hue.bg);
        want[1] = Math.max(0, want[2] - hue.bg * wanted);
        want[0] = Math.max(0, want[2] - hue.br * wanted);
        for (let c = 0; c < 3; c++) lit[c] = srgbToLinear(Math.min(1, Math.max(0, want[c])));
        agxInverse(lit, 1, lock);
      } else {
        for (let c = 0; c < 3; c++) lock[c] = scaled[c];
      }
    }
    const o = cell * 3;
    const asked = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const measuredHue = drop + chromaAt[o + c];
      const lockedHue = Math.log(Math.max(1e-9, lock[c]) / Math.max(1e-9, model[c]));
      asked[c] = lockStrength > 1e-4
        ? measuredHue * (1 - lockStrength) + lockedHue * lockStrength
        : measuredHue;
    }
    // The same rule the carry is bound by, applied to what it all adds up to:
    // green may lean either way and may not lead.
    asked[1] = Math.min(Math.max(asked[1], Math.min(asked[0], asked[2])),
      Math.max(asked[0], asked[2]));
    for (let c = 0; c < 3; c++) {
      table[o + c] = Math.min(RES_RANGE[1], Math.max(RES_RANGE[0], Math.exp(asked[c])));
    }
  }
  return { table, cells: measured.length };
}

export function sunVector(elevationDeg, azimuthDeg) {
  const ce = Math.cos(elevationDeg * DEG);
  return [
    ce * Math.sin(azimuthDeg * DEG),
    Math.sin(elevationDeg * DEG),
    -ce * Math.cos(azimuthDeg * DEG),
  ];
}

/** Direction from a bearing measured clockwise from north and an elevation. */
export function directionOf(elevationDeg, azimuthDeg) {
  return sunVector(elevationDeg, azimuthDeg);
}

/** Clear sky radiance for a bearing and a height, given where the sun is. */
export function clearSkyAt(p, sun, elevationDeg, azimuthDeg, out = [0, 0, 0]) {
  const d = directionOf(elevationDeg, azimuthDeg);
  const s = sunVector(sun.elevation, sun.azimuth);
  return clearSkyRadiance(
    p, elevationDeg, d[0] * s[0] + d[1] * s[1] + d[2] * s[2], out,
    relativeBearing(azimuthDeg, sun.azimuth), azimuthDeg,
  );
}

// ============================================================== the preset
//
// The clear sky as a handful of numbers, and the whole of what the dome is
// ever allowed to know.
//
// Everything above this line reads a photograph. The tables it produces — the
// bearing surface, the local residual — are measurements of one frame of one
// sky, and carried onto a dome they are the reason the dome had blotches: a
// measurement has a boundary, a boundary carried outwards is a contour, and a
// soft closed contour in an open sky is a stain whatever arithmetic drew it.
// Every attempt to hide one moved it. So the runtime dome is cut off from all
// of it, and what crosses this line instead is the MODEL: four shape numbers,
// three exposures and where the sun is.
//
// That is not a compromise, it is the property being bought. Rayleigh and Mie
// under one air mass is smooth by construction — a few exponentials of one
// monotone variable and one phase angle — so it cannot close a contour anywhere,
// at any bearing, from any standing place. There is no blotch to find because
// there is nothing in it that could draw one.
//
// The three costs are named rather than discovered. The reference's own sector
// no longer matches texel for texel, which is what the veil in src/ui/veil.js
// covers while the walker arrives and what the eye is asked to judge afterwards
// in family rather than in difference. The dither has to stay, because a
// gradient this smooth magnified over a screen quantises into bands. And the
// sun has to be drawn, because a physical sky with no sun in it is the one
// reading the model cannot give.
//
// WHERE A DAY AND A NIGHT WOULD HOOK ON. Everything below is a pure function of
// this object, and the object is a point in a small space of numbers: the two
// optical depths, the asymmetry, the multiple scattering term, three exposures,
// the sun's bearing and height, and the two lobes. A dusk or a night is another
// point of the same space — a sun near or under the horizon, a larger aerosol
// depth, a lower exposure — and a cycle is a path between two of them. Nothing
// here has to change for that: build a second preset, interpolate the numbers,
// and hand the result to the same evaluator and the same shader. What must NOT
// happen is a second code path; the moment two skies are drawn by two pieces of
// arithmetic, the dome and the water start disagreeing about where the sun is.

// The sun's own disc, in degrees of angular RADIUS.
//
// The real one is 0.266, and it is kept: a disc drawn larger to be seen is a
// disc that reads as a lamp. What makes it legible at that size is not its
// width but that it is HDR — some fifty times the sky beside it — so the bloom
// in src/core/post.js gives it a halo several degrees across, which is what a
// sun looks like through a lens and through an eye.
const SUN_DISC_DEG = 0.266;
// How the edge is let go: half the disc again, which at this size is a couple
// of pixels of the frame. A hard edge on a body this bright aliases into a
// crawling polygon as the eye turns, and it is also not what a sun has — the
// limb of one is softened by the same air the aureole is made of.
const SUN_DISC_SOFT_DEG = 0.18;
// How bright, as a multiple of the model's own exposure — so the disc carries
// the white point the fit arrived at rather than a colour chosen here, and so a
// preset that dims the sky dims the sun with it.
//
// Not the true ratio, which is five orders of magnitude and would leave a white
// hole in every frame it appeared in. What this number actually buys is the
// BLOOM: the disc is four or five pixels across, so what makes it read as a sun
// rather than as a moon is the halo post.js grows round it, and the halo is
// proportional to the energy inside those pixels. Measured on the frame, at the
// bloom threshold and strength this project is graded at: 2.8 lifts the sky
// beside the disc by three levels of eight bit colour, which is nothing; 20 by
// seventeen; 100 by fifty five, falling to five two and a half degrees out; 400
// by a hundred and six, still eleven degrees out, which is the sky around the
// sun being burnt rather than the sun flowering. A hundred is where the flower
// is whole and stops.
const SUN_DISC_LEVEL = 100;


/** Air mass at the horizon, and the slope it arrives there with. */
export const HORIZON_AIR_MASS = HORIZON_MASS;
export const HORIZON_AIR_MASS_SLOPE = HORIZON_MASS_SLOPE;
export const BELOW_HORIZON_SCALE = BELOW_HORIZON_TAU;

/**
 * The runtime sky, as the numbers that describe it and nothing else.
 *
 * The optical depths come out per channel rather than as one depth and a
 * wavelength law, so that the shader has three multiplies where it would
 * otherwise have three powers, and so that the wavelengths themselves live in
 * exactly one place — here.
 *
 * @param {object} params the fitted model; its shape and residual are dropped
 * @param {object} sun    where the fit put the sun
 */
export function dayPreset(params, sun) {
  const round = (v) => Number(v.toFixed(6));
  return {
    sun: {
      elevation: sun.elevation,
      azimuth: sun.azimuth,
      vector: sunVector(sun.elevation, sun.azimuth).map(round),
    },
    // Single scattering by air and by aerosol, per channel.
    tauRayleigh: rayleighScale.map((s) => round(params.tauRayleigh * s)),
    tauMie: mieScale.map((s) => round(params.tauMie * s)),
    // How far forward the aerosol throws what it scatters.
    g: round(params.g),
    // Everything scattered more than once, standing in as one isotropic term.
    ambient: round(params.ambient),
    exposure: params.exposure.map(round),
    // The circumsolar peak the single asymmetry above cannot reach, as the fit
    // read it off the sky between the reference's clouds.
    aureole: {
      wide: round(params.aureoleWide || 0),
      wideExponent: AUREOLE_WIDE_EXPONENT,
      narrow: round(params.aureoleNarrow || 0),
      narrowExponent: AUREOLE_NARROW_EXPONENT,
    },
    disc: {
      radiusDeg: SUN_DISC_DEG,
      softDeg: SUN_DISC_SOFT_DEG,
      level: SUN_DISC_LEVEL,
    },
  };
}

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * The dome, evaluated exactly as src/core/sky.js evaluates it.
 *
 * This is the JS twin of that shader and the two are one piece of arithmetic
 * written twice, which is a thing worth being uncomfortable about: the cloud
 * bake subtracts what this returns and the frame adds back what the shader
 * returns, so any difference between them lands in the frame as a halo round
 * every piece of weather. tools/grade/check-dome.mjs measures the two against
 * each other on the running page for exactly that reason.
 *
 * @param {object} preset   as dayPreset built it
 * @param {number[]} direction  unit vector, y up, -z north
 * @param {number} sharpness how much of the sun survives: one for the dome, and
 *   less for a surface that scatters what it reflects
 */
export function domeRadiance(preset, direction, out = [0, 0, 0], sharpness = 1) {
  const len = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  const y = direction[1] / len;
  const elevationDeg = Math.asin(Math.min(1, Math.max(-1, y))) / DEG;
  const m = airMass(90 - elevationDeg);
  const s = preset.sun.vector;
  const cosGamma = (direction[0] * s[0] + direction[1] * s[1] + direction[2] * s[2]) / len;

  const pr = rayleighPhase(cosGamma);
  const pm = miePhase(cosGamma, preset.g);
  // A rough surface reads a wider piece of sky than a mirror does, and the one
  // thing in this sky narrow enough to care is the sun. Blurring it is not a
  // level of a texture here, it is the lobe getting shorter: an exponent scales
  // with the inverse square of the angular width, so the sharpness IS that
  // scale, and at the roughness the stone asks for the narrow lobe is gone.
  const extra = aureolePhase(cosGamma, {
    aureoleWide: preset.aureole.wide, aureoleNarrow: preset.aureole.narrow,
  }, sharpness);

  // The disc keeps its energy as it spreads, exactly as a coarser level of a
  // texture would: the solid angle grows by the same factor the radiance falls
  // by, so a mirror shows a sun and a rough face shows the light of one.
  const spread = 1 / Math.sqrt(Math.max(1e-4, sharpness));
  const gamma = Math.acos(Math.min(1, Math.max(-1, cosGamma))) / DEG;
  const edge = preset.disc.radiusDeg * spread;
  const soft = preset.disc.softDeg * spread;
  const disc = (1 - smoothstep(edge - soft, edge + soft, gamma))
    * preset.disc.level * sharpness;
  // The disc takes the MEAN of the three exposures and not each of them, so the
  // only thing that gives the sun a colour is what the air takes out of it: the
  // fit folded the reference's white balance into the exposure, and a beam
  // carrying that balance is blue.
  const beam = (preset.exposure[0] + preset.exposure[1] + preset.exposure[2]) / 3;

  for (let c = 0; c < 3; c++) {
    const tr = preset.tauRayleigh[c];
    const tm = preset.tauMie[c];
    const tau = tr + tm;
    const source = (tr * pr + tm * (pm + extra) + preset.ambient * tau / (4 * Math.PI)) / tau;
    // One exponential, read twice: what the air has scattered into the ray is
    // one minus what it has let through, and the disc is what it has let
    // through. Which is also why the sun reddens on its own in a preset that
    // puts it near the horizon — nothing here has to be told to.
    const through = Math.exp(-tau * m);
    out[c] = preset.exposure[c] * source * (1 - through) + beam * disc * through;
  }
  return out;
}

/** The dome for a bearing and a height, for the tools that think in angles. */
export function domeAt(preset, elevationDeg, azimuthDeg, out = [0, 0, 0], sharpness = 1) {
  return domeRadiance(preset, directionOf(elevationDeg, azimuthDeg), out, sharpness);
}

// ---------------------------------------------------------------- sampling

/**
 * Every sky pixel of the reference, as scene radiance with its direction.
 * The reference is display referred, so the tone curve is undone here once and
 * the whole bake works in light from this point on.
 */
export function readSkySamples(skyReference, mask, lensShading = () => 1) {
  const ray = makeRay();
  const out = [];
  const display = [0, 0, 0];
  for (let y = 0; y < FRAME.height; y++) {
    for (let x = 0; x < FRAME.width; x++) {
      const i = y * FRAME.width + x;
      if (!mask[i]) continue;
      const shading = lensShading(x, y);
      for (let c = 0; c < 3; c++) display[c] = srgbToLinear(skyReference.data[i * 3 + c] / 255) / shading;
      const d = ray(x, y);
      const radiance = agxInverse(display, 1, [0, 0, 0]);
      out.push({
        x,
        y,
        elevation: Math.asin(d[1]) / DEG,
        azimuth: Math.atan2(d[0], -d[2]) / DEG,
        radiance,
        luminance: 0.2126 * radiance[0] + 0.7152 * radiance[1] + 0.0722 * radiance[2],
      });
    }
  }
  return out;
}

/**
 * The sky between the clouds, binned.
 *
 * Selected by colour, not by brightness. The darkest fifth of a bin is the
 * obvious choice and it is wrong here: over the middle of the framing the
 * reference is solid cumulus, so the darkest fifth of those bins is the shaded
 * belly of a cloud, and a fit fed on cloud bellies learns a sky that is dark
 * where the real one is bright. Clear sky is the bluest thing at any height,
 * whatever its brightness, and that is what is kept.
 */
function clearBins(samples, {
  elevationBin = 3, azimuthBin = 6, minCount = 150, quantile = 0.2, minBlueness = 0.10,
} = {}) {
  const cells = new Map();
  for (const s of samples) {
    const key = `${Math.round(s.elevation / elevationBin)}|${Math.round(s.azimuth / azimuthBin)}`;
    let list = cells.get(key);
    if (!list) { list = []; cells.set(key, list); }
    list.push(s);
  }
  const out = [];
  for (const [key, list] of cells) {
    if (list.length < minCount) continue;
    const [ke, ka] = key.split('|').map(Number);
    const blueness = (s) => {
      const r = s.radiance[0];
      const b = s.radiance[2];
      return r + b > 1e-9 ? (b - r) / (b + r) : 0;
    };
    list.sort((a, b) => blueness(b) - blueness(a));
    const keep = list.slice(0, Math.max(1, Math.round(list.length * quantile)));
    // A bin with no blue in it at all is under solid cloud and has nothing to
    // say about the sky behind it.
    const mean = keep.reduce((t, s) => t + blueness(s), 0) / keep.length;
    if (mean < minBlueness) continue;
    const radiance = [0, 1, 2].map((c) => keep.reduce((t, s) => t + s.radiance[c], 0) / keep.length);
    out.push({
      elevation: ke * elevationBin,
      azimuth: ka * azimuthBin,
      radiance,
      count: list.length,
      blueness: mean,
      luminance: 0.2126 * radiance[0] + 0.7152 * radiance[1] + 0.0722 * radiance[2],
    });
  }
  return out;
}

// -------------------------------------------------------------- the sun

/** Vertex of a parabola through the three points around the largest value. */
function peakOf(points) {
  if (points.length < 3) return null;
  let k = 0;
  for (let i = 1; i < points.length; i++) if (points[i].v > points[k].v) k = i;
  if (k === 0 || k === points.length - 1) return { at: points[k].at, edge: true };
  const [a, b, c] = [points[k - 1], points[k], points[k + 1]];
  const denom = (a.v - 2 * b.v + c.v);
  if (Math.abs(denom) < 1e-9) return { at: b.at, edge: false };
  const shift = 0.5 * (a.v - c.v) / denom;
  const step = c.at - b.at;
  return { at: b.at + shift * step, edge: false };
}

/**
 * Solar azimuth, from what the clear sky does across the sector.
 *
 * Two readings, deliberately of different kinds. Brightness is the obvious one
 * but it carries the vignette of the reference; hue does not, because a
 * vignette is a scalar and a scalar leaves a ratio alone. They are averaged,
 * and their disagreement is reported as the uncertainty.
 */
export function solarAzimuth(samples) {
  // Only the top of the framing, and not its corners. Low down the cloud never
  // opens wide enough for the darkest fifth of a bin to be sky at all, and the
  // two outer columns carry the corners of the reference, where the vignette
  // and the edge of a monolith both live.
  const bins = clearBins(
    samples.filter((s) => s.elevation >= 19 && Math.abs(s.azimuth) <= 31),
    { elevationBin: 3, azimuthBin: 6 },
  );
  const byAzimuth = new Map();
  for (const b of bins) {
    let e = byAzimuth.get(b.azimuth);
    if (!e) { e = { n: 0, rel: 0, warm: 0 }; byAzimuth.set(b.azimuth, e); }
    // Brightness relative to the mean of its own elevation, so the airlight
    // ramp does not decide which azimuth wins.
    const row = bins.filter((q) => q.elevation === b.elevation);
    const mean = row.reduce((t, q) => t + q.luminance, 0) / row.length;
    e.rel += b.luminance / mean;
    // Loss of blue: the ratio of the red channel to the green one rises where
    // aerosol scatters the sun forward into the line of sight.
    e.warm += b.radiance[0] / Math.max(1e-6, b.radiance[1]);
    e.n++;
  }
  const rows = [...byAzimuth.entries()]
    .filter(([, e]) => e.n >= 2)
    .map(([at, e]) => ({ at, rel: e.rel / e.n, warm: e.warm / e.n }))
    .sort((a, b) => a.at - b.at);

  const bright = peakOf(rows.map((r) => ({ at: r.at, v: r.rel })));
  const white = peakOf(rows.map((r) => ({ at: r.at, v: r.warm })));

  // Brightness decides. The two readings were averaged at first and the average
  // was wrong: the loss of blue is measured on the bluest fifth of a bin, and in
  // the two outer bins of the framing that fifth is the dark corner of the
  // reference, which is greyer than the sky beside it for reasons that have
  // nothing to do with the sun. That reading walks to the edge of the window
  // and stays there, so it is kept as a cross check and as the uncertainty, and
  // is only allowed to move the answer when it lands inside.
  const azimuth = white && !white.edge
    ? bright.at * 0.7 + white.at * 0.3
    : bright.at;
  return {
    azimuth,
    spread: white ? Math.abs(bright.at - white.at) / 2 : 20,
    brightestAt: bright ? bright.at : null,
    whitestAt: white ? white.at : null,
    whitestAtEdge: Boolean(white && white.edge),
    profile: rows,
  };
}

/**
 * True when no face the framing shows is turned towards the given azimuth,
 * which is the reading that puts the sun behind the monoliths.
 */
export function facesAllInShadow(faceAzimuths, sunAzimuth) {
  return faceAzimuths.every((a) => {
    let d = a - sunAzimuth;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return Math.abs(d) > 80;
  });
}

/**
 * Builds that surface from the measured bins, and hands back the part of it
 * that is a constant per channel so it can be folded into the exposure and
 * leave pure shape behind.
 */
function fitCorrection(bins, sun, params) {
  const out = [0, 0, 0];
  const cells = new Map();
  for (const b of bins) {
    clearSkyAt(params, sun, b.elevation, b.azimuth, out);
    const y = Math.round((b.elevation - HEIGHT_LO) / HEIGHT_STEP);
    const x = Math.round(relativeBearing(b.azimuth, sun.azimuth) / BEARING_STEP);
    const key = y * BEARING_CELLS + x;
    let cell = cells.get(key);
    if (!cell) { cell = { n: 0, ratio: [0, 0, 0] }; cells.set(key, cell); }
    for (let c = 0; c < 3; c++) cell.ratio[c] += Math.log(Math.max(1e-6, b.radiance[c]) / Math.max(1e-6, out[c]));
    cell.n++;
  }
  const measured = [...cells.entries()].filter(([, r]) => r.n >= 2);
  if (measured.length < 8) return { table: null, whiteBalance: [1, 1, 1] };

  const whiteBalance = [0, 1, 2].map((c) => Math.exp(
    measured.reduce((t, [, r]) => t + r.ratio[c] / r.n, 0) / measured.length,
  ));
  const value = new Float64Array(HEIGHT_CELLS * BEARING_CELLS);
  const have = new Uint8Array(HEIGHT_CELLS * BEARING_CELLS);
  for (const [key, r] of measured) {
    value[key] = Math.exp([0, 1, 2].reduce(
      (t, c) => t + (r.ratio[c] / r.n - Math.log(whiteBalance[c])), 0,
    ) / 3);
    have[key] = 1;
  }

  // Held outwards along the bearing first, because that is the axis the
  // framing runs out of, and then along the height.
  for (let y = 0; y < HEIGHT_CELLS; y++) {
    let last = -1;
    for (let x = 0; x < BEARING_CELLS; x++) {
      const k = y * BEARING_CELLS + x;
      if (have[k]) last = k; else if (last >= 0) { value[k] = value[last]; have[k] = 2; }
    }
    last = -1;
    for (let x = BEARING_CELLS - 1; x >= 0; x--) {
      const k = y * BEARING_CELLS + x;
      if (have[k] === 1) last = k; else if (last >= 0 && have[k] !== 1) { value[k] = value[last]; have[k] = have[k] || 2; }
    }
  }
  for (let x = 0; x < BEARING_CELLS; x++) {
    let last = -1;
    for (let y = 0; y < HEIGHT_CELLS; y++) {
      const k = y * BEARING_CELLS + x;
      if (have[k]) last = k; else if (last >= 0) { value[k] = value[last]; have[k] = 3; }
    }
    last = -1;
    for (let y = HEIGHT_CELLS - 1; y >= 0; y--) {
      const k = y * BEARING_CELLS + x;
      if (have[k] && have[k] !== 3) last = k; else if (last >= 0) { value[k] = value[last]; have[k] = have[k] || 3; }
    }
  }
  for (let k = 0; k < value.length; k++) if (!have[k]) value[k] = 1;

  const smooth = Float64Array.from(value);
  for (let y = 0; y < HEIGHT_CELLS; y++) {
    for (let x = 0; x < BEARING_CELLS; x++) {
      let sum = 0; let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = Math.min(HEIGHT_CELLS - 1, Math.max(0, y + dy));
          const xx = Math.min(BEARING_CELLS - 1, Math.max(0, x + dx));
          sum += value[yy * BEARING_CELLS + xx]; n++;
        }
      }
      smooth[y * BEARING_CELLS + x] = Math.min(1.9, Math.max(0.5, sum / n));
    }
  }
  return { table: smooth, whiteBalance };
}

// ---------------------------------------------------------------- the fit

function residual(bins, sun, p) {
  let err = 0;
  const out = [0, 0, 0];
  for (const b of bins) {
    clearSkyAt(p, sun, b.elevation, b.azimuth, out);
    for (let c = 0; c < 3; c++) {
      // Relative error: the sector spans a factor of ten in brightness and an
      // absolute fit would see only the horizon.
      const t = b.radiance[c];
      err += ((out[c] - t) / Math.max(0.02, t)) ** 2;
    }
  }
  return Math.sqrt(err / (bins.length * 3));
}

/** Exposure is linear in the model, so it is solved rather than searched. */
function solveExposure(bins, sun, p) {
  const num = [0, 0, 0];
  const den = [0, 0, 0];
  const out = [0, 0, 0];
  const unit = { ...p, exposure: [1, 1, 1] };
  for (const b of bins) {
    clearSkyAt(unit, sun, b.elevation, b.azimuth, out);
    for (let c = 0; c < 3; c++) {
      const w = 1 / Math.max(0.02, b.radiance[c]) ** 2;
      num[c] += w * out[c] * b.radiance[c];
      den[c] += w * out[c] * out[c];
    }
  }
  return [0, 1, 2].map((c) => (den[c] > 0 ? num[c] / den[c] : 1));
}

/**
 * Fits the clear sky and the solar elevation together on the sky between the
 * clouds. The azimuth arrives measured; the elevation is bounded below by the
 * top of the framing, because a disc inside it would be visible and is not.
 */
export function fitClearSky(samples, { azimuth, minElevation = 34, maxElevation = 62 }) {
  const bins = clearBins(samples, { elevationBin: 2, azimuthBin: 5, minCount: 120, quantile: 0.15 });
  if (bins.length < 30) throw new Error(`only ${bins.length} clear sky bins`);

  // The two lobes are searched only where they are wanted, and they are wanted
  // in exactly one place: the shape free fit the DOME is built from.
  //
  // The model with its surface on is what tools/clouds/bake-sprites.mjs takes
  // every decision about the weather on — which texels are cloud, where a
  // window closes, which pieces earn a place in the library. That composition
  // was certified as it stands, and it must not move because the dome grew a
  // sun. Letting the lobes into this fit moved it: the sky near the sun came up
  // by a tenth or more, the coverage read differently under it, and two masses
  // came back with windows half again as large.
  const search = (sunElevation, shape = null, lobes = false) => {
    const sun = { elevation: sunElevation, azimuth };
    let best = null;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    // Coarse pass over the four shape parameters, then a shrinking local walk.
    for (let tR = BOUNDS.tR[0]; tR <= BOUNDS.tR[1]; tR *= 1.3) {
      for (let tM = BOUNDS.tM[0]; tM <= BOUNDS.tM[1]; tM *= 1.4) {
        for (let g = BOUNDS.g[0]; g <= BOUNDS.g[1]; g += 0.08) {
          for (let ambient = 0; ambient <= BOUNDS.ambient[1]; ambient += 0.25) {
            const p = {
              tauRayleigh: tR, tauMie: tM, g, ambient, shape, exposure: [1, 1, 1],
              aureoleWide: 0, aureoleNarrow: 0,
            };
            p.exposure = solveExposure(bins, sun, p);
            const err = residual(bins, sun, p);
            if (!best || err < best.err) best = { err, p };
          }
        }
      }
    }
    // The lobes walk ADDITIVELY and the rest multiplicatively, because the
    // lobes start at nothing and a proportion of nothing is nothing.
    let step = {
      tR: 0.3, tM: 0.4, g: 0.07, ambient: 0.4, aureoleWide: 0.16, aureoleNarrow: 0.8,
    };
    for (let round = 0; round < 26; round++) {
      let moved = false;
      const p = best.p;
      const candidates = [
        { tauRayleigh: clamp(p.tauRayleigh * (1 + step.tR), ...BOUNDS.tR) },
        { tauRayleigh: clamp(p.tauRayleigh / (1 + step.tR), ...BOUNDS.tR) },
        { tauMie: clamp(p.tauMie * (1 + step.tM), ...BOUNDS.tM) },
        { tauMie: clamp(p.tauMie / (1 + step.tM), ...BOUNDS.tM) },
        { g: clamp(p.g + step.g, ...BOUNDS.g) }, { g: clamp(p.g - step.g, ...BOUNDS.g) },
        { ambient: clamp(p.ambient + step.ambient, ...BOUNDS.ambient) },
        { ambient: clamp(p.ambient - step.ambient, ...BOUNDS.ambient) },
      ];
      if (lobes) {
        candidates.push(
          { aureoleWide: clamp((p.aureoleWide || 0) + step.aureoleWide, ...BOUNDS.aureoleWide) },
          { aureoleWide: clamp((p.aureoleWide || 0) - step.aureoleWide, ...BOUNDS.aureoleWide) },
          { aureoleNarrow: clamp((p.aureoleNarrow || 0) + step.aureoleNarrow, ...BOUNDS.aureoleNarrow) },
          { aureoleNarrow: clamp((p.aureoleNarrow || 0) - step.aureoleNarrow, ...BOUNDS.aureoleNarrow) },
        );
      }
      for (const change of candidates) {
        const q = { ...p, ...change, shape, exposure: [1, 1, 1] };
        q.exposure = solveExposure(bins, sun, q);
        const err = residual(bins, sun, q);
        if (err < best.err) { best = { err, p: q }; moved = true; }
      }
      if (!moved) {
        step = {
          tR: step.tR * 0.6,
          tM: step.tM * 0.6,
          g: step.g * 0.6,
          ambient: step.ambient * 0.6,
          aureoleWide: step.aureoleWide * 0.6,
          aureoleNarrow: step.aureoleNarrow * 0.6,
        };
        if (step.g < 0.002) break;
      }
    }
    return best;
  };

  // Two rounds. The correction surface and the angular shape of the model are
  // not independent: fitted together the model spends its freedom flattening
  // the vertical ramp, which is the one thing the correction is there to do,
  // and has nothing left for the lobe round the sun. So the model is fitted,
  // the surface is read off what is left, and the model is fitted again against
  // a sky it no longer has to explain the shape of.
  let bestSun = null;
  let shape = null;
  for (let round = 0; round < 2; round++) {
    bestSun = null;
    for (let e = minElevation; e <= maxElevation; e += 6) {
      const r = search(e, shape);
      if (!bestSun || r.err < bestSun.err) bestSun = { ...r, elevation: e };
    }
    for (const e of [bestSun.elevation - 4, bestSun.elevation - 2, bestSun.elevation + 2, bestSun.elevation + 4]) {
      if (e < minElevation || e > maxElevation) continue;
      const r = search(e, shape);
      if (r.err < bestSun.err) bestSun = { ...r, elevation: e };
    }
    const sun = { elevation: bestSun.elevation, azimuth };
    const fitted = fitCorrection(bins, sun, { ...bestSun.p, shape: null });
    shape = fitted.table;
    bestSun.p = {
      ...bestSun.p,
      exposure: bestSun.p.exposure.map((v, c) => v * fitted.whiteBalance[c]),
    };
  }

  // How flat the minimum is, in degrees: the range of solar elevations whose
  // error is within a twentieth of the best. Reported rather than hidden,
  // because a sky this far from a physical one cannot pin a sun to a degree.
  const tolerated = [];
  for (let e = minElevation; e <= maxElevation; e += 4) {
    if (search(e, shape).err <= bestSun.err * 1.05) tolerated.push(e);
  }

  const params = { ...bestSun.p, shape };
  const sun = { elevation: bestSun.elevation, azimuth };
  const beforeResidual = residual(bins, sun, params);

  // And the same model fitted for the job the DOME actually gives it.
  //
  // Everything above deliberately relieves the model of the vertical ramp: the
  // surface is read off what the model leaves and the model is then fitted
  // again against a sky it no longer has to explain the shape of, so that its
  // freedom goes into the lobe round the sun instead. That is the right split
  // when the surface travels with it.
  //
  // The dome carries no surface. So it is fitted once more with nothing beside
  // it, and this is the fit that ships. It is not a worse fit made to look
  // better — it is a different question: not "what is left for the model once
  // the tables have spoken" but "what is the best smooth physical sky this
  // reference can be read as". The two disagree most at the zenith, which the
  // surface was carrying almost half a stop of, and where a model fitted with
  // the surface in place arrives too pale — the deep blue overhead is the one
  // thing about this sky the committente names first.
  const plainFit = search(bestSun.elevation, null, true);

  // Read on bins half the size the model was fitted on: the model is a smooth
  // thing and wants a lot of sky under each sample, while this is a map of
  // where the reference departs from it and wants resolution.
  // Read on bins narrow enough to have one of their own against the boundary of
  // the framing. Three degrees of bearing is wider than the edge shading it has
  // to see, and the bin that would have straddled the boundary never had the
  // count to survive, so the last reading the residual ever got on that side was
  // taken a degree and a half inside the picture.
  const fine = clearBins(samples, {
    elevationBin: 2, azimuthBin: 1.5, minCount: 50, quantile: 0.15,
  });
  const local = fitLocalResidual(fine, sun, params);
  params.residual = local.table;

  return {
    params,
    // The shape free model, which is what the dome is built from.
    plainParams: plainFit.p,
    plainError: plainFit.err,
    error: residual(bins, sun, params),
    errorBeforeResidual: beforeResidual,
    modelError: bestSun.err,
    residualCells: local.cells,
    sun,
    elevationRange: tolerated.length ? [Math.min(...tolerated), Math.max(...tolerated)] : [bestSun.elevation, bestSun.elevation],
    bins: bins.length,
    measured: bins,
  };
}

/** The fit against what it was fitted to, binned by `key`. */
export function describeFit({ params, sun, measured }, key = 'elevation') {
  const rows = new Map();
  const out = [0, 0, 0];
  for (const b of measured) {
    clearSkyAt(params, sun, b.elevation, b.azimuth, out);
    let row = rows.get(b[key]);
    if (!row) { row = { at: b[key], n: 0, model: [0, 0, 0], target: [0, 0, 0] }; rows.set(b[key], row); }
    for (let c = 0; c < 3; c++) { row.model[c] += out[c]; row.target[c] += b.radiance[c]; }
    row.n++;
  }
  return [...rows.values()]
    .map((r) => ({
      at: r.at,
      model: r.model.map((v) => v / r.n),
      target: r.target.map((v) => v / r.n),
    }))
    .sort((a, b) => b.at - a.at);
}
