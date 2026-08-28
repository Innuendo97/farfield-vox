import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  FRAME, POSE, REPO_ROOT, makeRay,
} from '../grade/lib/framing.mjs';
import { writeCleanPng } from '../grade/lib/png.mjs';
import { agx } from '../grade/lib/agx.mjs';
import { agxInverse } from '../grade/lib/agx-inverse.mjs';
import { linearToSrgb, srgbToLinear } from '../grade/lib/color.mjs';
import {
  buildSkyMask, buildStoneMask, fitStoneToReference, readSkyReference,
} from '../grade/lib/target.mjs';
import { makeLensShading, referenceShading, screenRadius } from '../grade/lib/shading.mjs';
import {
  clearSkyAt, domeAt, domeRadiance, fitClearSky, readSkySamples, solarAzimuth, sunVector,
} from '../grade/lib/sky-model.mjs';
import {
  CLOUD_CHROMA, COVER_FLOOR, NORMAL_SLOPE, SHADE_AMBIENT, SHADE_DIFFUSE, SHADE_FORWARD,
  settleCloud, shadeAt, sunInLocalFrame,
} from '../grade/lib/cloud-field.mjs';
import { completeByExemplar } from '../grade/lib/exemplar.mjs';

// Cuts the reference's own weather out of the reference and into sprites.
//
// The dome behind this carries no cloud: what the reference shows in front of
// its sky is at a distance of kilometres, and a picture of it wrapped on a
// sphere a metre from the eye turns with the walker instead of standing still.
// So the cloud is drawn as bodies — flat quads, out beyond everything else in
// the world, each one a piece of the photograph.
//
// Three things make that legal, and all three are done here.
//
// THE PROJECTION. A tile is cut in the tangent plane of its own centre, which is
// the projection a flat quad facing that centre already is. Laid back down at
// the bearing it was cut from, at the reference pose, it reproduces the
// reference's own pixels — not approximately, exactly, because the two
// projections are the same projection.
//
// THE SHADING. A piece of cloud carries the light it had where it was
// photographed, and put down somewhere else it would carry the wrong light; the
// eye reads wrong light long before it reads a repeated shape. So a piece that
// moves is multiplied at runtime by the ratio of the shading it should have to
// the shading it came with, both read from its own coverage, and what survives
// that is the material: the texture, the grain, the way an edge frays.
//
// A piece that does not move is multiplied by nothing at all, and that is worth
// saying plainly, because it decides what this atlas stores. The obvious packing
// puts a level, a coverage and the two legs of a normal in the four channels and
// reconstructs the hue from the shading — and it was built and measured: the hue
// a cumulus has is not a function of how it is lit to better than six units of
// chromaticity in the mean and forty at the ninety ninth, which is several times
// the whole error this session is allowed. So the four channels carry the
// photograph instead — three of colour, premultiplied, and the coverage — and
// the normal the relighting needs is read at runtime from the coverage's own
// gradient. The ratio of two shadings taken from one gradient does not care what
// level of detail that gradient was read at, which is the property that makes it
// affordable; and a mass that stays where the reference put it arrives with the
// reference's own colour, unmodelled.
//
// THE WINDOW. A sprite may never carry mass against the edge of its own render
// window: against open sky such a cut is invisible, against a monolith face it
// is a ruled line, and no texture work hides it. The field is faded over the
// outer 14% of every half extent and the tail is then cut, and what that
// achieved is measured per tile rather than assumed.
//
// WHERE THE PHOTOGRAPH DID NOT SEE, NOTHING IS PUT.
//
// A monolith takes a piece of sky out of the reference, and for thirteen gates
// this tool filled that piece back in — a patch search, then a rim match, then a
// band limit, then a harmonic extension — because there really is cloud behind a
// monolith and a walker who steps sideways is owed it. Every one of those was a
// treatment applied to the TEXTURE of material nobody photographed, and none of
// them touched the decision to invent it; what the walker saw, from six and
// twelve metres to either side, was a milky curtain whose straight edge was the
// block's own silhouette, because a region invented against a region measured
// differs over exactly the shape that separated them.
//
// So the hole is not filled. Under it is the analytic dome, which is certified
// uniform and clean at every pitch and bearing, and a gap of clear sky between
// two banks is what a sky does. What is allowed is the one thing that is not an
// invention: the photograph's own coverage at the rim of a hole, carried a
// degree into it and brought to nothing, so a bank that runs behind a block does
// not stop dead on the block's outline. Past that degree there is sky.
//
// Past the EDGE OF THE FRAME is a different question with a different answer,
// and it keeps its own. A bank that ran out of photograph is not a hole in the
// picture: nothing encloses it, and a sprite that stopped where the frame stops
// would draw a horizon of its own across the sky. That continuation is still
// carried from the reference's own cloud, brought down to nothing over
// CONTINUATION_DEG with the tail cut rather than faded, and held to the body and
// reach tests below.

const OUT_DIR = join(REPO_ROOT, 'assets-src', 'clouds');
const OUT_IMAGE = join(OUT_DIR, 'cloud-sprites.png');
const OUT_EQUIRECT = join(OUT_DIR, 'cloud-equirect.png');
const OUT_PARAMS = join(OUT_DIR, 'clouds.json');

const DEG = Math.PI / 180;
const W = FRAME.width;
const H = FRAME.height;

// The atlas, and how finely the sky is written into it.
//
// The rate is the reference's own, near enough: the framing carries 19.8 pixels
// to the degree at its centre and 30.6 at its edge, and the hero bank straddles
// both. Cut at the centre's rate the right of it would be softer than the
// picture; cut at the edge's, most of the atlas would go on resolving a
// sharpness only the corner of one frame ever had.
const ATLAS = { width: 2048, height: 1024 };

// How finely a tile is written, as a multiple of the rate the reference frame
// itself carries where that tile stands.
//
// A tile is cut in the tangent plane of its own centre, which is the projection
// a flat quad facing that centre already is — so at the reference pose the map
// from tile to screen is very nearly a scale, and that scale is what this sets.
// One would be the exact number for anything the reference shows: the resampling
// would be a unit resampling and the sprite would carry the photograph's own
// sharpness. It is a shade under one because the atlas has a weight to keep and
// this is the cheapest place to find it — a hundredth of a millimetre of
// softness against a twentieth of the file — and because a tile written just
// under the screen's rate is magnified rather than minified wherever the frame
// is densest, which is where the sampler would otherwise blend two levels.
//
// The library is never compared to anything: it is laid down at bearings the
// reference never showed, rolled, mirrored and rescaled, so writing it at the
// reference's rate would spend a third of the atlas on a sharpness no frame
// asks of it.
const RATE = { hero: 0.95, mass: 0.95, library: 0.55 };

// Zero texels between neighbours, so the first mip levels cannot carry one
// tile's rim into the next.
const GUTTER = 8;

// The outer fraction of each half extent the field is faded over.
//
// This is the guillotine, and it is the whole of it. A sprite baked with mass
// hard against its own border is cut off by that border, and that cut is a ruled
// line wherever the sprite meets something solid — which is exactly where this
// sky meets the fourth monolith.
const EDGE_FADE = 0.14;

// How much of a library piece has to be solid cloud before it is worth laying
// down anywhere. Measured on the first library, after its matte: the pieces the
// eye picked out as pale patches carried eight per cent of their own area
// solid, and the ones that read as cloud carried thirteen to twenty four. The
// matte takes roughly half of it, so the figure asked of the material before it
// is twice the figure wanted after.
const BODY_SHARE = 0.28;

// And that body has to HANG TOGETHER: this much of it in one connected piece.
//
// A cumulus is one mass with lobes on it. A window of broken veil carries the
// same share of solid in a hundred specks with sky between them, and it reads at
// the size it was cut and reads as lichen the moment it is laid down at twice
// that — which is exactly the word the reviewer used for the piece this test
// does not choose.
const BODY_TOGETHER = 0.45;

// How much of its own envelope a piece's body has to fill before it is a heap.
//
// The falx gate. What it costs is written down rather than glossed: the pool
// drops from fourteen distinct pieces to eleven, and the eleven that survive
// fill between 0.68 and 0.98 of their envelope. Three of this photograph's
// windows were bows, and at the scales the plan lays them — up to two and a half
// times the size they were cut — a bow is the one shape in this sky the eye
// finds every time.
//
// Eleven is still enough for the rule that matters, and that is checked rather
// than hoped: twenty seven placements over eleven pieces is at most three of any
// one, and the twins invariant still reports no two inside one field of view.
const BODY_HEAP = 0.66;

// How much brighter than the sky behind it the body of a piece has to be.
//
// This is the test that tells weather from veil, and it is the one the first two
// libraries had no version of. The upper left of this frame is deep blue under a
// thin dark haze: the separation reads that haze as a coverage a cumulus would
// be proud of — it is bluer than the sky and it varies — and the colour it
// leaves is two nearly equal numbers subtracted. Laid down anywhere else, at
// twice the size it was cut, what arrives is a brown blot with a lace edge.
//
// A cumulus is not a subtle thing. Measured against the fitted clear sky at its
// own bearing, the bodies of this frame's real clouds come in at two and a half
// to four times it and its hazes at under one and a half.
const CLOUD_LIFT = 1.9;

// And how blue that body has to be against how red.
//
// The lift catches most of the haze and not all of it: a window of the upper
// left with a bright edge in it clears twice the sky and still arrives brown,
// because what makes it brown is not how much light it has but which light. This
// frame's real cloud bodies sit between two and two and nine tenths of blue for
// every unit of red, and the three pieces the eye called lichen sat between one
// and two thirds and one and three quarters. There is no overlap to argue about.
const CLOUD_BLUE = 1.85;

// And the silhouette of a piece may not be its own window. A cover that keeps
// every cell of the rectangle is a rectangle, whatever the coverage inside it
// does, and one laid down small is a pale patch with four corners.
const MAX_COVER_SHARE = 0.92;

// The tail of the coverage, cut rather than faded.
//
// What survives a fade is a skirt of coverage a few per cent deep over the whole
// rectangle, and a few per cent of coverage still carries colour: a haze in the
// shape of the window, with an edge where the fade finally reaches nothing. Cut,
// there is no skirt and no edge, and what is left is a torn rim that follows the
// material's own texture.
const TAIL_CUT = 0.10;

// How far a bank is carried past the edge of the photograph before it is taken
// down to nothing, in degrees of sky.
//
// It was seven, and seven drew an anvil. The number does two jobs and only the
// second one shows. It is the distance the coverage decays over; and, through
// the kernel the edge's own coverage is carried outwards with, which is a fifth
// of it, it is how far ALONG the edge a texel of continuation reads its
// coverage from. At seven that reading is a degree and a half wide, so a turret
// standing four and a half degrees wide where the frame ran out lent its
// coverage to two and a half degrees of open sky either side of it, and what
// came back was a cap of sixteen square degrees at coverage 0.996 — with a flat
// underside, because the line the smear was read along is the straight top edge
// of the frame. That is the shape the client's walk stopped on, and no amount of
// texture on it would have helped: it is not a surface, it is a silhouette.
//
// Read over a shorter line the smear cannot cross from a turret to the sky
// beside it, and what is left above the bank is the bank's own top, decaying
// inside the strip and torn by the tail cut rather than shelving out. Measured
// at the client's pose against the same frame with the weather switched off, in
// levels of the eight bit frame, over the two hundred by sixty pixels the cap
// stood in: seven leaves 49.7 of mean difference and 74% of the box over six
// levels; two and a half leaves 0.4 and 0.9%.
//
// Two other ways of ending that cap were built and measured, and both drew what
// they were made of. Narrowing it against how deep the bank still is under each
// point of the edge — a continuation may rise as high as it stands wide — took
// the shelf away and put a straight sided pyramid in its place, because the
// contour of a distance transform against a linear rise is a cone and the
// invented material up there is a smooth wash with no texture to hide it.
// Breaking the underside with noise at the scale of the bank's own lobes failed
// the tool's own ruled line invariant outright, at 108 levels down five pixels
// against the 70 one is allowed: an irregular edge is still an edge.
//
// And the number may not grow back. The same sweep, read over the hundred and
// ten by eighty pixels the tenth gate's hook stood in: 2 -> 1.8, 2.5 -> 0.6,
// 3 -> 0.4, 3.5 -> 6.3, against 0.8 at seven. Three and a half hangs a pale
// closed lobe in clean sky beside the bank — the hook's own family, thin enough
// to pass under the solid closeContinuation reads bodies at and near enough one
// to pass its reach. Two and a half is measured on both counts.
const CONTINUATION_DEG = 2.5;

// Coverage below this is read as clear sky rather than as thin cloud, and is
// where the division by the coverage runs away.
const THIN = 0.10;

// The transparency the sharing between overlapping windows may reach.
//
// Sharing a material out between windows is sharing its TRANSPARENCY: each
// window keeps T raised to its own part of the whole, and the product over the
// windows is T again, for any number of them and any split. That is exact, and
// it has one hole in it. At T exactly nought — a texel of solid cloud — T to any
// positive power is still nought, so a window fading out over the last per cent
// of its own width carries that texel at FULL coverage right up to its border
// and stops. Which is the guillotine, arrived at through the very arithmetic
// that was meant to keep the fade honest, and it is what put a rectangular slab
// of cloud in the sky behind the fifth block.
//
// So the transparency is floored at one step of the channel it is stored in.
// What the composite then returns is the material short by that one step
// wherever it was fully opaque — under the dither the frame already adds — and
// what every window's own coverage does at its own border is fall to nothing,
// whatever the material there is doing.
const OPAQUE_FLOOR = 1 / 255;

// How far into the drawn region the coverage is brought down to nothing at an
// edge the cover itself cuts, as a share of one cell.
//
// The cover is a set of cells, and the boundary of that set is a staircase of
// straight lines. Coverage standing on it is a straight line in the sky by the
// same argument as the window's own border, and the answer is the same answer:
// the field dies inside the cut rather than at it.
const CELL_FADE = 0.35;

// Where the material a tile is cut from stops being cloud.
//
// The same floor the sky bake uses, and it was worth proving rather than
// assuming, because a sprite is not the case that floor was chosen for: a
// sprite's colour is stored as the DIFFERENCE from the fitted clear sky, so a
// piece composited back over that sky returns the reference's own pixel
// whatever the coverage believed — and a coverage floored to nothing throws the
// difference away with it, since a fragment with no coverage is discarded
// before it is blended. The fringe of diffuse light that stands round a cloud
// edge lives exactly there.
//
// So it was cut to four per cent and measured. What came back was a quarter of
// a megabyte of atlas, six more points of silhouette to fill, and a frame whose
// clear sky moved by nothing at all — because this sky is already MILKIER than
// the reference's, not thinner: read over the hero bank with the stone taken
// out, the reference's darkest twentieth is 94 and this frame's is 102, and
// over the deep blue at the left of the frame the reference is 56 and this
// frame 78. There is no fringe missing to put back.
const CUT_FLOOR = COVER_FLOOR;

// The tail cut from what was carried rather than measured. The separation
// floors the reference's own clear sky to nothing; a field carried outwards has
// no floor, and a few per cent of coverage over degrees of sky is haze nobody
// photographed.
const SYNTHETIC_TAIL = 0.07;

// How far the photograph is carried INTO the hole a block leaves, in degrees.
//
// This is the whole of what stands where the completion used to, and its size is
// the argument for it. A degree is the reach the tool already trusts everywhere
// else — the distance closeContinuation calls "a degree either side of a body
// that was never there". Counted, as everything invented here is, at the rate
// the DENSEST corner of this framing carries, which is thirty four pixels; the
// centre of the frame carries twenty, so a degree here is a degree and two
// thirds where the blocks stand, and it is stated that way rather than quietly.
//
// What it buys is the one thing the alternative could not give. Leaving the hole
// at nothing outright is honest and it still draws a line: the photograph's own
// coverage stands at the rim, the hole beside it is zero, and the boundary
// between them is the block's silhouette, which is a rectangle. Carried, the
// coverage at the rim is the coverage the photograph has there and it reaches
// nothing a degree in, so there is no step anywhere — and because a degree is
// far less than a block is wide, the middle of every hole is sky.
//
// What it is NOT is a completion. Nothing is searched for, nothing is matched,
// nothing is invented: the value at a texel is the average of the photograph
// within reach of it, which is bounded by the photograph on every side and
// carries no structure the photograph did not have. Where a block stands against
// clear sky the average is clear sky and the tail cut takes what little is left,
// so what the walker finds behind it is the dome.
//
// And it is a measured optimum rather than a round number, in the one reading
// that decides it: the vertical edge the composition carries from the four
// standing places of the walk, against the 54.8 the photograph's own weather
// carries. At nothing the collar is a cut on the block's own outline and the
// four bearings read 42, 47, 70, 83 — the bake fails. At half a degree, 56, 65,
// 71, 66 — it fails. At one, 40, 43, 48, 46, which is the lowest this tool has
// ever read. At two, 43, 49, 48, 47, and the step the invention puts across five
// pixels behind a block goes from 24 levels to 57. At three, 48, 56, 52, 48 —
// it fails again. There is one degree of room and this is it.
//
// Liftable from the command line, and only so the invariants can be shown
// FINDING the fault they were built for: carried far enough the average floods
// the whole hole, the block's outline comes back, and the bake fails on it.
// A run that ships never lifts it.
const HOLE_CARRY_DEG = Number(process.env.FARFIELD_HOLE_CARRY ?? 1);

// How the patch search completes what lies PAST THE EDGE OF THE PHOTOGRAPH.
//
// Wider patches and fewer levels than the sky bake uses, and no settling. The
// sky bake fills ribbons and silhouettes in a field with no structure of its
// own; here the material is cauliflower, where a three texel patch matches
// anywhere and the search answers with a weave. And the settling — which forces
// every completed texel to a level near the cloud's own — is what a sky needs
// and a cloud does not: applied to a bank it flattens the gaps between the
// turrets into one slab.
const FILL = {
  radius: Number(process.env.FARFIELD_FILL_RADIUS ?? 5),
  levels: Number(process.env.FARFIELD_FILL_LEVELS ?? 6),
  iterations: Number(process.env.FARFIELD_FILL_ITERATIONS ?? 6),
  settle: (process.env.FARFIELD_FILL_SETTLE ?? '0') === '1',
};

/**
 * A field averaged over the texels that mean anything, and nowhere else.
 *
 * A normalised convolution: the field times its weight, and the weight, both
 * blurred by the same kernel and divided. Three box passes, because the third
 * convolution of a box is near enough a Gaussian that nothing in a sky can tell,
 * and it is three adds a texel however wide the kernel is — which matters,
 * because this kernel is forty texels wide.
 *
 * Unlike extendOutwards, the answer is the blur EVERYWHERE, including where the
 * field is known: what the caller does with it there is the caller's business.
 */
function lowPass(value, weight, width, height, radius, channels = 1) {
  const n = width * height;
  const v = new Float32Array(n * channels);
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!weight[i]) continue;
    w[i] = 1;
    for (let c = 0; c < channels; c++) v[i * channels + c] = value[i * channels + c];
  }
  const line = new Float32Array(Math.max(width, height));
  // One run of a box filter along a line of a buffer, in place: the buffer is
  // addressed as (base + i * step) * span + channel, which covers a row and a
  // column of a field of any number of channels with one piece of code.
  const box = (buf, count, base, step, span, channel, r) => {
    for (let i = 0; i < count; i++) line[i] = buf[(base + i * step) * span + channel];
    let sum = 0;
    for (let i = 0; i <= r && i < count; i++) sum += line[i];
    for (let i = 0; i < count; i++) {
      const lo = i - r - 1;
      const hi = i + r;
      if (hi < count) sum += line[hi];
      if (lo >= 0) sum -= line[lo];
      const reach = Math.min(count - 1, hi) - Math.max(0, lo + 1) + 1;
      buf[(base + i * step) * span + channel] = sum / reach;
    }
  };
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < height; y++) {
      box(w, width, y * width, 1, 1, 0, radius);
      for (let c = 0; c < channels; c++) box(v, width, y * width, 1, channels, c, radius);
    }
    for (let x = 0; x < width; x++) {
      box(w, height, x, width, 1, 0, radius);
      for (let c = 0; c < channels; c++) box(v, height, x, width, channels, c, radius);
    }
  }
  const out = new Float32Array(n * channels);
  for (let i = 0; i < n; i++) {
    if (w[i] <= 1e-6) continue;
    for (let c = 0; c < channels; c++) out[i * channels + c] = v[i * channels + c] / w[i];
  }
  return out;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const log = (line) => process.stdout.write(`${line}\n`);
const round = (v, n = 3) => Number(v.toFixed(n));

/** Scene radiance as one number of the eight bit frame the walker is delivered. */
function displayLevel(rgb) {
  const tone = agx(rgb, 1);
  let luma = 0;
  for (let c = 0; c < 3; c++) {
    luma += [0.2126, 0.7152, 0.0722][c]
      * linearToSrgb(Math.min(1, Math.max(0, tone[c])));
  }
  return 255 * luma;
}

/**
 * The dome the frame actually draws, as the preset that ships describes it.
 *
 * Read for the two sky invariant and for nothing else. No number out of this
 * file reaches a sprite — that is the whole of what this session fixed — so the
 * dependency is a check's dependency: run the sky bake before this one, or the
 * check cannot be made.
 */
function readDayPreset() {
  const file = join(REPO_ROOT, 'assets-src', 'sky', 'sky.json');
  const day = JSON.parse(readFileSync(file, 'utf8')).day;
  if (!day) throw new Error(`${file} carries no day preset: run the sky bake first`);
  return day;
}

// ---------------------------------------------------------------- the framing

const ray = makeRay();

/** Direction of a bearing and a height, in the world basis of layout.js. */
function directionOf(azimuthDeg, elevationDeg) {
  const e = elevationDeg * DEG;
  const a = azimuthDeg * DEG;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
}

/** The reference camera, as a projection of a direction back onto the frame. */
function makeProjector() {
  const tanV = Math.tan(POSE.fov * DEG / 2);
  const tanH = tanV * (W / H);
  const cp = Math.cos(POSE.pitch * DEG);
  const sp = Math.sin(POSE.pitch * DEG);
  return function project(d) {
    const y = d[1] * cp + d[2] * sp;
    const z = -d[1] * sp + d[2] * cp;
    if (z >= -1e-6) return null;
    return [
      ((d[0] / -z) / tanH * 0.5 + 0.5) * W - 0.5,
      (0.5 - (y / -z) / tanV * 0.5) * H - 0.5,
    ];
  };
}

/**
 * The most pixels of the reference frame that one degree of sky ever occupies.
 *
 * A rectilinear projection does not carry the sky evenly: this framing spends
 * 19.1 pixels on a degree at its centre and 33.6 at its corner, because the
 * scale goes as the secant squared of the angle off the axis. A kernel stated
 * in pixels is therefore a different kernel in the sky at each place, and a
 * ceiling that has to hold EVERYWHERE has to be set from the tightest of them.
 */
function pxPerDegree() {
  const tanV = Math.tan(POSE.fov * DEG / 2);
  const tanH = tanV * (W / H);
  const corner = Math.hypot(tanH, tanV);
  return W / (2 * tanH) * (1 + corner * corner) * DEG;
}

/**
 * The local frame of a tile: east, up and the direction itself.
 *
 * The same three axes the shading is expressed in, so a normal read off a tile
 * and a sun put into that tile's frame are talking about the same thing.
 */
function tileBasis(azimuthDeg, elevationDeg) {
  const c = directionOf(azimuthDeg, elevationDeg);
  const a = azimuthDeg * DEG;
  const right = [Math.cos(a), 0, Math.sin(a)];
  const up = [
    right[1] * c[2] - right[2] * c[1],
    right[2] * c[0] - right[0] * c[2],
    right[0] * c[1] - right[1] * c[0],
  ];
  const len = Math.hypot(up[0], up[1], up[2]) || 1;
  return { c, right, up: [up[0] / len, up[1] / len, up[2] / len] };
}

// ------------------------------------------------------ the reference, undone

/**
 * Where the land is, as a skyline.
 *
 * The reference's own hills reach a third of the way up the frame and its
 * furthest ridges are pale grey rock: read on colour alone a peak is a cloud,
 * and the map this bake was planned from has two of them in it. So the land is
 * found as land — the one region that reaches the bottom of the frame — by
 * walking each column up from the foot until the ground stops, and then taking
 * the median across neighbouring columns, because a column that runs up a
 * monolith answers nonsense and a landscape's skyline does not jump.
 */
function findGround(radiance, elev, azim, stone, fit) {
  const RUN = 14;
  const MEDIAN = 16;
  const rgb = [0, 0, 0];
  const groundLike = (x, y) => {
    const i = y * W + x;
    const r = radiance[i * 3];
    const g = radiance[i * 3 + 1];
    const b = radiance[i * 3 + 2];
    clearSkyAt(fit.params, fit.sun, Math.max(-2, elev[i]), azim[i], rgb);
    const want = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    const have = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // Green is the one hue in this frame that neither sky nor cloud has, and
    // darkness is what the rest of the land has instead.
    return (g - (r + b) / 2) > 0.006 * want || have < 0.62 * want;
  };

  // A column with a monolith standing in it has no skyline to report: the block
  // is dark all the way up and every test for land answers yes to it. Such a
  // column is left blank and the land is carried across it from the two sides,
  // which is what the reference itself does — the hills do not stop at a stone.
  const column = new Int32Array(W).fill(-1);
  for (let x = 0; x < W; x++) {
    let stones = 0;
    for (let y = 420; y < H; y++) if (stone[y * W + x]) stones++;
    if (stones > (H - 420) * 0.25) continue;
    let top = -1;
    for (let y = H - 1; y >= 240; y--) {
      let solid = true;
      for (let k = 0; k < RUN && solid; k++) {
        const yy = Math.min(H - 1, y + k);
        // Stone breaks neither the run nor the column: it is in front of the
        // land, not part of it.
        if (stone[yy * W + x]) continue;
        if (!groundLike(x, yy)) solid = false;
      }
      if (solid) top = y;
      else if (top >= 0) break;
    }
    column[x] = top;
  }

  const median = new Int32Array(W).fill(-1);
  for (let x = 0; x < W; x++) {
    if (column[x] < 0) continue;
    const list = [];
    for (let k = -MEDIAN; k <= MEDIAN; k++) {
      const xx = Math.min(W - 1, Math.max(0, x + k));
      if (column[xx] >= 0) list.push(column[xx]);
    }
    list.sort((a, b) => a - b);
    median[x] = list[list.length >> 1];
  }
  const skyline = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    if (median[x] >= 0) { skyline[x] = median[x]; continue; }
    let left = x;
    while (left >= 0 && median[left] < 0) left--;
    let right = x;
    while (right < W && median[right] < 0) right++;
    if (left < 0 && right >= W) { skyline[x] = H; continue; }
    if (left < 0) { skyline[x] = median[right]; continue; }
    if (right >= W) { skyline[x] = median[left]; continue; }
    const t = (x - left) / (right - left);
    skyline[x] = Math.round(median[left] * (1 - t) + median[right] * t);
  }

  const ground = new Uint8Array(W * H);
  let n = 0;
  for (let x = 0; x < W; x++) {
    for (let y = skyline[x]; y < H; y++) { ground[y * W + x] = 1; n++; }
  }
  log(`land: skyline between rows ${Math.min(...skyline)} and ${Math.max(...skyline)}, `
    + `${(100 * n / (W * H)).toFixed(1)}% of the frame`);
  return ground;
}

/**
 * Splits the sky of the reference into the sky behind and the cloud in front.
 *
 * The same two readings the sky bake separates an equirect with — loss of blue
 * where there is light to lose it in, and brightness against the fitted model —
 * asked of the frame directly rather than of a projection of it. That is not a
 * refinement: an equirect resolving this frame's own sharpness would be eleven
 * thousand texels wide, and the cauliflower of a cumulus is the one thing here
 * that no resampling may be allowed to soften.
 *
 * Colour comes out premultiplied and as the difference from the clear sky, so
 * recomposing over that same sky returns the reference's pixel unchanged.
 */
/**
 * The sky a sprite is CUT FROM, which is no longer the sky it is drawn over.
 *
 * That is a reversal, and it is worth saying why, because the opposite was
 * argued here and was right at the time.
 *
 * A sprite stores the reference minus the sky behind it, so that laying it back
 * over that same sky returns the reference. While the dome WAS a picture of the
 * reference's own sky, the two skies could be made the same object, and they
 * were: one bake, subtracted here and added back at runtime, and no way for
 * them to disagree about anything.
 *
 * The dome is now a physical model, and it does not match the photograph — it
 * is fifty four per cent relative rms away from it, because a smooth analytic
 * sky is what was asked for and a photograph is not smooth. Subtract THAT and
 * every sprite carries the difference: at the rim of a cloud the coverage goes
 * to nothing and what is left in the tile is the model's error, a low frequency
 * wash of sky with the tile's own rectangle round it. Where the tile ends, the
 * wash ends — and a wash that ends at a straight edge is exactly the squared
 * fringe and the halo round the weather the committente failed the frame for.
 *
 * So the subtraction is the sky the PHOTOGRAPH has, fitted: the model with the
 * bearing surface and the local residual on it, which is the closest smooth
 * thing to what is actually behind each cloud. A sprite then carries cloud and
 * only cloud, and goes to nothing exactly where its coverage does.
 *
 * What the frame draws is then radiance + (dome - photograph) * (1 - cover):
 * the cloud bodies are the photograph, the sky between them is the model, and
 * the crossing between the two is the cloud's own alpha — a shape the weather
 * already has, rather than one the bake introduced.
 *
 * None of this material reaches the dome. It lives in the atlas, inside the
 * silhouette of a cumulus, which is the one place a measurement of a photograph
 * is allowed to be.
 */
function readDome(fit) {
  log('sky for the separation: the fitted model with its surface and residual, '
    + 'which is the sky the photograph has behind its own clouds — '
    + 'NOT the analytic dome the frame draws');
  return (direction, out) => {
    const elevation = Math.asin(Math.max(-1, Math.min(1, direction[1]))) / DEG;
    const azimuth = Math.atan2(direction[0], -direction[2]) / DEG;
    return clearSkyAt(fit.params, fit.sun, elevation, azimuth, out);
  };
}

function separate(radiance, elev, azim, stone, ground, fit, dome) {
  // Two readings of the same estimate. The first is what every DECISION is
  // taken on — where a window has to stop, which pieces are worth a library,
  // what coverage each band of the reference carries — and it keeps the sky
  // bake's own floor, so those decisions are the ones that were already
  // judged. The second is the MATERIAL the tiles are cut from, and it keeps
  // the fringe.
  const alpha = new Float32Array(W * H);
  const cutAlpha = new Float32Array(W * H);
  const colour = new Float32Array(W * H * 3);
  const cutColour = new Float32Array(W * H * 3);
  const clear = [0, 0, 0];
  const plain = [0, 0, 0];
  const plainModel = { ...fit.params, residual: null };
  // The sky the photograph has behind each of its own texels, kept rather than
  // evaluated twice: the layer below is a statement about the photograph
  // AGAINST THIS SKY, and a second evaluation would be a second chance to
  // disagree with the one the separation was taken on.
  const skyAt = new Float32Array(W * H * 3);

  // What counts as covered at a given height: the sky between the clouds is the
  // bluest thing in the row, an opaque cloud the least blue.
  const blueClear = new Float32Array(H);
  const blueCloud = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const list = [];
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (stone[i] || ground[i]) continue;
      const r = radiance[i * 3];
      const b = radiance[i * 3 + 2];
      if (r + b <= 1e-6) continue;
      list.push((b - r) / (b + r));
    }
    if (list.length < 16) { blueClear[y] = 0.5; blueCloud[y] = 0.1; continue; }
    list.sort((a, b) => a - b);
    blueCloud[y] = list[Math.floor(list.length * 0.03)];
    blueClear[y] = list[Math.floor(list.length * 0.97)];
  }

  for (let y = 0; y < H; y++) {
    let bc = 0;
    let bk = 0;
    let n = 0;
    for (let k = -6; k <= 6; k++) {
      const yy = Math.min(H - 1, Math.max(0, y + k));
      bc += blueCloud[yy]; bk += blueClear[yy]; n++;
    }
    bc /= n; bk /= n;
    const span = Math.max(0.05, bk - bc);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (ground[i]) continue;
      // The sky the sprite will be laid over, for the MATERIAL; and the clean
      // model, for every DECISION. Keeping the decisions on the model is what
      // holds the composition the eighth gate certified: the coverage, and so
      // the windows, the library and the placements, do not move when the dome
      // does.
      //
      // The sky is kept BEHIND THE BLOCKS as well, where there is no photograph
      // to separate. The carry into the holes leaves material along their rims,
      // that material is drawn, and the layer has to be able to say what it is
      // made of — which it cannot do without knowing what sky it stands against.
      dome(ray(x, y), clear);
      for (let c = 0; c < 3; c++) skyAt[i * 3 + c] = clear[c];
      if (stone[i]) continue;
      clearSkyAt(plainModel, fit.sun, elev[i], azim[i], plain);
      const r = radiance[i * 3];
      const g = radiance[i * 3 + 1];
      const b = radiance[i * 3 + 2];
      const blue = (r + b) > 1e-6 ? (b - r) / (b + r) : 0.5;
      const yTarget = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const yClear = 0.2126 * plain[0] + 0.7152 * plain[1] + 0.0722 * plain[2];
      const lit = yTarget / Math.max(1e-4, yClear);
      const bySaturation = Math.min(1, Math.max(0, (bk - blue) / span))
        * smoothstep(0.55, 0.95, lit);
      const byBrightness = Math.min(1, Math.max(0, (lit - 1.05) / 1.6));
      const raw = Math.min(1, Math.max(bySaturation, byBrightness));
      const a = Math.max(0, (raw - COVER_FLOOR) / (1 - COVER_FLOOR));
      const cut = Math.max(0, (raw - CUT_FLOOR) / (1 - CUT_FLOOR));
      alpha[i] = a;
      cutAlpha[i] = cut;
      for (let c = 0; c < 3; c++) {
        colour[i * 3 + c] = radiance[i * 3 + c] - clear[c] * (1 - a);
        cutColour[i * 3 + c] = radiance[i * 3 + c] - clear[c] * (1 - cut);
      }
    }
  }
  return {
    alpha, colour, cutAlpha, cutColour, skyAt,
  };
}

// What a cloud in this photograph IS, and what the sky behind it is worth —
// both read off the picture rather than written down, because a number written
// down here is a number that stops describing the next photograph.
//
// THE CEILING is the brightest colour this reference's own solid cloud carries,
// per channel. Nothing measured is ever dimmed by it, because it is taken from
// the measurement; what it stops is a texel asking for a colour no cloud in
// this picture has.
//
// THE FIT'S WORTH is how far the fitted sky and the photograph disagree where
// the separation finds no cloud at all: the median, per channel, so a departure
// the fit is as likely as not to be responsible for is not read as weather.
// This reference gives about a tenth, which is a great deal, and it is the
// honest figure — a smooth analytic sky fitted to an illustration is not a
// photometer, and pretending the last tenth of it is cumulus is what filled the
// thin end of the atlas with arithmetic.
function readCloudBounds(material) {
  const {
    radiance, stone, ground, cutAlpha, skyAt, completed,
  } = material;
  const SOLID = 0.92;
  const ceiling = [0, 0, 0];
  const off = [[], [], []];
  for (let i = 0; i < W * H; i++) {
    // Off the photograph only. What stands behind a block is the photograph's
    // own rim carried inwards, and a carried texel may not be asked what a cloud
    // is: it would be the same reading twice, at a coverage nobody read.
    if (stone[i] || ground[i] || (completed && completed[i])) continue;
    const cut = cutAlpha[i];
    if (cut >= SOLID) {
      for (let c = 0; c < 3; c++) {
        const s = skyAt[i * 3 + c];
        ceiling[c] = Math.max(ceiling[c], (radiance[i * 3 + c] - s * (1 - cut)) / cut);
      }
    } else if (cut <= 0) {
      for (let c = 0; c < 3; c++) {
        const s = Math.max(1e-9, skyAt[i * 3 + c]);
        off[c].push(Math.abs(radiance[i * 3 + c] - s) / s);
      }
    }
  }
  const worth = off.map((list) => {
    if (!list.length) return 0;
    list.sort((p, q) => p - q);
    return list[list.length >> 1];
  });
  return { ceiling, worth };
}

// Development handle, and the only reason it exists: the invariant below has to
// be shown FINDING the fault it was built for. With the layer off the bake
// stores the photograph minus a sky again, and the two sky reading has to fail.
// A run that ships never turns it off.
const SKY_LAYER = (process.env.FARFIELD_SKY_LAYER ?? '1') === '1';

/**
 * The weather as a LAYER, which is the whole of this fix.
 *
 * A sprite is composited premultiplied, so what the frame draws where it stands
 * is exactly premul + dome*(1 - cover). Storing the photograph minus the sky it
 * was photographed under makes that photograph + (dome - photograph's sky) *
 * (1 - cover): a term that is nobody's weather, at full strength wherever the
 * coverage runs out, and bounded by the tile's own rectangle. That term is the
 * milky curtain with the straight edge.
 *
 * There is no treatment for it, because it is not an artefact of an edge: it is
 * what the stored quantity MEANS. So the stored quantity changes. A texel keeps
 * a coverage and a COLOUR A CLOUD HAS, and the premultiplied value is the
 * product of the two — which makes the composite cover*colour + (1-cover)*sky,
 * a blend between a cloud and whatever is behind it. Three things follow, and
 * all three are what this session was asked for:
 *
 * THE COLOUR DIES WITH THE COVERAGE. It is a product, so as the coverage goes
 * to nothing so does everything the sprite adds — there is no residue left to
 * end at a rectangle, whatever sky it is laid over.
 *
 * THE DISAGREEMENT TERM IS BOUNDED BY THE COVERAGE. The sky the photograph had
 * does not appear in what is stored through (1 - cover) any more. It is not
 * gone: a cover and a colour whose product is the departure the photograph
 * shows is a family, and every member of it carries cover*(that sky - this one)
 * onto any other sky. What is left is that term, in proportion to the coverage,
 * and the solve below says why the least-carrying member of the family is not
 * the one taken.
 *
 * IT COMPOSES ON ANY SKY. A blend between a cloud and the sky behind it is what
 * weather does at dusk as much as at noon, so a second preset moves the sky
 * under these clouds and nothing else has to be rebaked.
 *
 * What it costs is the split between how much sky is hidden and how bright the
 * thing hiding it is. Where the photograph is darker than its own fitted sky,
 * the old arithmetic asked for a NEGATIVE colour — sixty six per cent of the
 * thinnest band of this picture — and the atlas clamped it to nothing, which is
 * what ate the semitransparent flanks of the western masses. A layer cannot
 * subtract light: it buys that darkening with coverage instead, so the flank
 * comes back as the thin veil it is. Where the photograph is brighter than any
 * cloud could be at the coverage read, the coverage rises for the same reason.
 * Both are exact: over the sky the photograph has, the composite still returns
 * the photograph's own pixel, because the colour is solved at the coverage that
 * was arrived at.
 */
function solveLayer(material) {
  const {
    stone, ground, skyAt, cutAlpha, cutColour,
  } = material;
  const { ceiling, worth } = readCloudBounds(material);
  material.cloudCeiling = ceiling;
  log(`a cloud in this photograph: brightest ${ceiling.map((v) => v.toFixed(2)).join('/')} `
    + `per channel, and the fitted sky is worth ${worth.map((v) => `${(100 * v).toFixed(1)}%`).join('/')} `
    + 'where the separation finds no cloud');
  if (!SKY_LAYER) {
    log('  THE LAYER IS OFF: the material stays the photograph minus that sky, '
      + 'and the two sky invariant has to fail on it');
    return;
  }
  let raised = 0;
  let drawn = 0;
  let rise = 0;
  for (let i = 0; i < W * H; i++) {
    // Behind a block as well as in front of it: what the carry left there is
    // drawn, so it is held to the same statement as the photograph's own.
    if (ground[i]) continue;
    const was = cutAlpha[i];
    if (was <= 0) {
      // NO COVERAGE, NO COLOUR, and this line is most of the fault.
      //
      // The separation floors the coverage and does not floor what it stores
      // beside it: a texel of clear sky comes out with no cover at all and with
      // the photograph's own departure from its fitted sky still in its colour,
      // which is the fit's error and nobody's weather. Left there it is
      // invisible — a fragment with no coverage is discarded — right up until a
      // tile is cut, because a tile is cut with a bilinear gather: the texel one
      // step away contributes its colour to a sample whose coverage came from
      // its neighbours. Measured on this bake, that alone had texels asking for
      // a cloud a hundred and thirty two times the sky against a ceiling of
      // seventeen, at the rim of every cloud in the atlas.
      for (let c = 0; c < 3; c++) cutColour[i * 3 + c] = 0;
      continue;
    }
    drawn++;
    // The picture this texel is carrying, whoever put it there: what the frame
    // would draw if it were laid back over the sky it was cut from. For a
    // measured texel that is the photograph exactly; for a carried one it is the
    // average of the photograph the carry took, which is the only honest thing
    // to call a photograph out there. One map, applied to both, so the rim where
    // they meet cannot gain a step from the mapping.
    const seen = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      seen[c] = cutColour[i * 3 + c] + skyAt[i * 3 + c] * (1 - was);
    }
    // What the photograph departs from its own sky by, with the fit's own error
    // taken out of it. Soft, so a body of cloud loses the same hundredth of
    // itself everywhere and a whisper loses all of itself: a hard threshold
    // here would be one more edge, at whatever contour the fit happens to fail
    // by that much along.
    const d = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const sky = skyAt[i * 3 + c];
      const raw = seen[c] - sky;
      d[c] = Math.sign(raw) * Math.max(0, Math.abs(raw) - worth[c] * sky);
    }
    // THE COVERAGE THE SEPARATION READ IS KEPT, and raised where the departure
    // cannot be expressed at it. It is not lowered, and that is a decision with
    // a measurement behind it rather than an omission.
    //
    // Over the sky the photograph has, every pair (cover, colour) whose product
    // cover*(colour - sky) equals the departure gives the photograph back, so
    // the separation's own reading is one of a family. Over any OTHER sky S the
    // same pair draws S + departure + cover*(sky - S): the sky the cut was taken
    // against, carried in proportion to the COVERAGE. The member of the family
    // that carries least is the one with the LEAST coverage the departure can be
    // expressed at, and taking it is the whole of the obvious answer.
    //
    // It was built and measured and it is worse. The least coverage puts every
    // texel's light into the thinnest cover it will fit in and at the brightest
    // colour a cloud in this picture has, so the reference's own material comes
    // out thin and hard: the photograph's own weather bar fell from 45.7 to 26.1
    // levels of vertical edge, a quarter of the atlas had to be held back off
    // the ceiling instead of a ten-thousandth, and where the field's own cover
    // says there is nothing it went from drawing 0.8 levels to drawing 15.5. The
    // two sky invariant below refuses that material, which is the invariant
    // working.
    //
    // So the sky-carry is left at cover*(sky - S) and bounded by the coverage,
    // and what is NOT left is the whole of the thirteenth gate's curtain: see
    // the reading in the report at the foot of this session. This is a floor
    // under the fault, not its end.
    let need = was;
    for (let c = 0; c < 3; c++) {
      const sky = skyAt[i * 3 + c];
      // The brightest cloud in the photograph, and not the sky where the sky is
      // brighter still. Inside the aureole it is: a few degrees around the sun
      // the fitted sky runs past anything the reference's own cloud carries, and
      // letting the bound follow it there is letting a texel ask for a cloud
      // that does not exist in this picture — the ceiling gate below catches
      // exactly that, and caught it. A departure no cloud could account for is
      // therefore not accounted for; near the sun a wisp is drawn a little
      // fainter than the photograph had it, which is the honest end of it.
      const top = ceiling[c];
      // Darker than the sky behind it is coverage, not a negative colour; and
      // brighter than a cloud can be is coverage too.
      if (d[c] < 0) need = Math.max(need, -d[c] / Math.max(1e-9, sky));
      if (d[c] > 0 && top > sky) need = Math.max(need, d[c] / (top - sky));
    }
    need = Math.min(1, need);
    if (need > was + 1e-6) { raised++; rise += need - was; }
    cutAlpha[i] = need;
    for (let c = 0; c < 3; c++) {
      const sky = skyAt[i * 3 + c];
      const own = (sky + d[c] - sky * (1 - need)) / need;
      cutColour[i * 3 + c] = need * Math.min(ceiling[c], Math.max(0, own));
    }
  }
  log(`  the layer: coverage rose on ${(100 * raised / Math.max(1, drawn)).toFixed(1)}% of the `
    + `${drawn} texels the material draws, by ${(rise / Math.max(1, raised)).toFixed(3)} on `
    + 'average — that rise is the darkening the old arithmetic asked a negative colour for');
}

/**
 * Carries the photograph a little way into the holes the blocks left, and
 * leaves the rest of every hole as sky.
 *
 * This stands where a completion used to, and it is not a smaller completion: it
 * is the decision not to make one. A monolith takes a piece of the picture away,
 * and the honest statement about what is behind it is that nobody knows. Put
 * anything there and it differs from what stands beside it over a region whose
 * shape is the block's own silhouette — which is a rectangle, which is what
 * thirteen gates were shown and what the client photographed twice.
 *
 * What is left is a statement the photograph can back: the coverage the
 * photograph has AT THE RIM of a hole does not stop at the rim. A bank running
 * behind a block goes on a little way behind it, so the measurement is carried a
 * degree in and brought to nothing, and past that degree the sprite carries no
 * coverage at all and the dome is what the walker sees.
 *
 * The carry is a normalised convolution over the measurement alone — the field
 * times where it is known and where it is known, both blurred by the same kernel
 * and divided — so a texel inside the hole takes the average of the photograph
 * within reach of it, weighted by how near that photograph is. It is bounded by
 * the photograph on every side, it is continuous with it at the rim by
 * construction, and it can hold no structure the photograph did not have. There
 * is no threshold in it and no boundary anywhere, which is the property the
 * patch search never had.
 *
 * Once, in the frame, before any window is cut, for the reason the completion
 * was also done once: every window that reaches over a block then reads the same
 * answer, and two overlapping windows share their material out exactly because
 * they agree.
 */
function carryIntoHoles(material) {
  const {
    stone, ground, cutAlpha, cutColour,
  } = material;
  const n = W * H;
  const hole = new Uint8Array(n);
  let holes = 0;
  for (let i = 0; i < n; i++) {
    // Only where a block stands against sky. A block standing against the land
    // is not a hole in the weather, and each window brings its own sky down to
    // nothing there anyway.
    if (!stone[i] || ground[i]) continue;
    hole[i] = 1;
    holes++;
  }
  material.completed = hole;
  if (!holes) return;

  // Where the photograph is a reading of the sky: not the land, which carries no
  // weather, and not the stone, which carries no picture.
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) seen[i] = (stone[i] || ground[i]) ? 0 : 1;

  const reach = Math.max(2, HOLE_CARRY_DEG * pxPerDegree());
  const field = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    // The coverage and the PREMULTIPLIED colour, because that is what the frame
    // adds and it is the pair an average may be taken of: the quotient has to be
    // floored to exist where there is no cloud, and whatever it is floored at is
    // a contour of its own along the coverage's own level set.
    field[i * 4] = cutAlpha[i];
    for (let k = 0; k < 3; k++) field[i * 4 + 1 + k] = cutColour[i * 3 + k];
  }
  const into = distanceTo(seen, W, H).dist;
  // ONE WIDE AVERAGE, and its width is a third of the reach so that three box
  // passes carry it exactly that far and no further.
  //
  // Two narrower ways of carrying the same measurement were built and measured,
  // and both were worse in the one way that matters. Diffusing it a ring of four
  // pixels at a time — the average of the photograph, then the average of that,
  // and so on inwards — is continuous with the photograph to the pixel and dies
  // too fast: half the material the reach asks for is gone by the time it gets
  // there, so what is left is a short steep collar, and the lateral reading went
  // from 48 of vertical edge to 85 against the 55 the photograph's own weather
  // carries. Crossing a two pixel average into the wide one over the first eight
  // pixels — which is the obvious cure for the one thing the wide average does
  // badly, since a mean is not continuous with what it is a mean of — puts the
  // photograph's own rim detail one step inside the hole and then takes it away
  // again over the reach: 90 of vertical edge, worse still.
  //
  // So the smoothness is not a side effect here, it is the property being
  // bought. What it costs is stated in the report rather than hidden: a texel
  // just inside the hole reads the neighbourhood's mean where the texel just
  // outside reads the photograph, and where a dense cumulus runs into a block
  // that is worth about two levels of the delivered frame.
  const carried = lowPass(field, seen, W, H, Math.max(1, Math.round(reach / 3)), 4);

  let alive = 0;
  let deepest = 0;
  for (let i = 0; i < n; i++) {
    if (!hole[i]) continue;
    if (into[i] > deepest) deepest = into[i];
    const base = carried[i * 4];
    // One at the rim, nothing a degree in. Smooth on both ends, so the carry
    // steps neither against the photograph it leaves nor against the sky it
    // reaches.
    const value = base * smoothstep(reach, 0, into[i]);
    // And the tail is cut, ramped from the rim so it never steps against the
    // measurement it meets there. What it takes is the whisper of coverage a
    // block standing in clear sky would otherwise wear as a collar.
    const tail = SYNTHETIC_TAIL * smoothstep(2, reach, into[i]);
    const kept = Math.max(0, (value - tail) / (1 - tail));
    // The colour dies with the coverage, here as everywhere: one scale for the
    // four channels, so a texel on its way out never asks for a brighter cloud
    // than the one it was carried from.
    const scale = base > 1e-6 ? kept / base : 0;
    cutAlpha[i] = kept;
    for (let k = 0; k < 3; k++) cutColour[i * 3 + k] = carried[i * 4 + 1 + k] * scale;
    if (kept > THIN) alive++;
  }
  log(`blocks: ${holes} texels of sky behind stone, ${deepest.toFixed(0)} px deep at the `
    + `worst; the photograph is carried ${HOLE_CARRY_DEG} deg (${reach.toFixed(0)} px) into `
    + `them and nothing else is, so ${alive} of them carry weather and `
    + `${holes - alive} carry the dome`);
}

// How far clear of the stone the material is read, in pixels of the frame.
//
// One, and it is the width of a bilinear tap. The last pixel before a block is a
// blend of that block's lit edge with the sky beside it, and the separation reads
// a blend of white paint and blue sky as solid cloud: measured on this
// photograph, the coverage at the column before the third block jumps from 0.16
// to 0.86 in a single pixel and holds it for two hundred rows. That is not a
// cloud, it is the outline of a monolith, and it was arriving in the sprites as
// a bright vertical bar one pixel wide at exactly the bearing the eighth gate
// reported a slab from — because the tiles are cut with a bilinear gather, which
// spreads that one pixel to three.
//
// So the silhouette is fitted to the reference first, as the sky bake fits it,
// and then held clear by a tap. What is given up is a one pixel ring of true sky
// round every block, and it is given up on purpose: that ring is the rim the
// carry above reads the hole's own coverage from, and a rim made half of stone
// is a rim that carries the block's paint into the sky.
const STONE_GUARD_PX = 1;

/** A mask grown by a few pixels, chebyshev, separably. */
function dilate(mask, width, height, radius) {
  const rows = new Uint8Array(width * height);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = 0;
      for (let k = -radius; k <= radius && !hit; k++) {
        if (mask[y * width + Math.min(width - 1, Math.max(0, x + k))]) hit = 1;
      }
      rows[y * width + x] = hit;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = 0;
      for (let k = -radius; k <= radius && !hit; k++) {
        if (rows[Math.min(height - 1, Math.max(0, y + k)) * width + x]) hit = 1;
      }
      out[y * width + x] = hit;
    }
  }
  return out;
}

async function readMaterial() {
  const reference = await readSkyReference();
  const skyMask = await buildSkyMask();
  const projected = await buildStoneMask();
  const refitted = fitStoneToReference(projected, reference);
  log(`silhouettes fitted to the reference on ${refitted.length} edge(s): ${refitted.join(' ') || 'none'}`);
  const stone = dilate(projected, W, H, STONE_GUARD_PX);
  for (let i = 0; i < skyMask.length; i++) if (stone[i]) skyMask[i] = 0;

  const lens = makeLensShading();
  const total = (x, y) => lens.at(x, y) * referenceShading(screenRadius(x, y));
  const azimuthReading = solarAzimuth(readSkySamples(reference, skyMask, lens.at));
  const azimuth = Math.round(azimuthReading.azimuth * 10) / 10;
  const fit = fitClearSky(readSkySamples(reference, skyMask, total), { azimuth });
  const sun = sunVector(fit.sun.elevation, azimuth);
  log(`sun: elevation ${fit.sun.elevation} deg, azimuth ${azimuth} deg; `
    + `clear sky fit ${(fit.error * 100).toFixed(1)}% relative rms`);

  const radiance = new Float32Array(W * H * 3);
  const elev = new Float32Array(W * H);
  const azim = new Float32Array(W * H);
  const display = [0, 0, 0];
  const out = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const shade = total(x, y);
      for (let c = 0; c < 3; c++) {
        display[c] = srgbToLinear(reference.data[i * 3 + c] / 255) / shade;
      }
      agxInverse(display, 1, out);
      for (let c = 0; c < 3; c++) radiance[i * 3 + c] = out[c];
      const d = ray(x, y);
      elev[i] = Math.asin(Math.max(-1, Math.min(1, d[1]))) / DEG;
      azim[i] = Math.atan2(d[0], -d[2]) / DEG;
    }
  }

  const dome = readDome(fit);
  const ground = findGround(radiance, elev, azim, stone, fit);
  const separated = separate(radiance, elev, azim, stone, ground, fit, dome);
  const day = readDayPreset();
  const material = {
    stone, ground, ...separated, fit, sun, azimuth,
    radiance,
    // The sky the photograph HAS, which is what the separation is taken
    // against; and the sky the FRAME DRAWS, which is what every reading of what
    // the field puts on the screen has to be taken against. Two different
    // objects since the dome became a model, and the whole of this session is
    // that only the first of them may reach a sprite.
    dome,
    frameDome: (direction, out) => domeRadiance(day, direction, out),
  };
  carryIntoHoles(material);
  // And the layer LAST, after every decision has been taken.
  //
  // Where a window has to stop, which pieces earn a place in the library, what
  // each band of the reference carries: all of those are read off the coverage
  // the separation gives and the carry into the holes leaves, and that
  // composition is the one the gates certified. Solving the layer before them moves it — measured,
  // when this was tried: the growing found different quiet borders and two of
  // the western masses came back at different bearings with windows a third
  // smaller. So the layer is a map applied to the finished material and to
  // nothing else, and what it changes is what the atlas CARRIES, never what the
  // bake DECIDED.
  material.decided = Float32Array.from(material.cutAlpha);
  solveLayer(material);
  return material;
}

// -------------------------------------------------------------------- a tile

/**
 * Angular window of a box of the frame, in the tangent plane of its centre.
 *
 * Measured round the whole perimeter rather than at its corners: a box wide
 * enough to matter is bent by the projection, and its highest point is in the
 * middle of its top edge and not at either end of it.
 */
function windowOf(box) {
  const [x0, y0, x1, y1] = box;
  const cd = ray((x0 + x1) / 2, (y0 + y1) / 2);
  const azimuth = Math.atan2(cd[0], -cd[2]) / DEG;
  const elevation = Math.asin(Math.max(-1, Math.min(1, cd[1]))) / DEG;
  const { c, right, up } = tileBasis(azimuth, elevation);
  let halfU = 0;
  let halfV = 0;
  const consider = (px, py) => {
    const d = ray(px, py);
    const w = d[0] * c[0] + d[1] * c[1] + d[2] * c[2];
    if (w <= 1e-6) return;
    halfU = Math.max(halfU, Math.abs(
      (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / w));
    halfV = Math.max(halfV, Math.abs(
      (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / w));
  };
  for (let x = x0; x <= x1; x += 4) { consider(x, y0); consider(x, y1); }
  for (let y = y0; y <= y1; y += 4) { consider(x0, y); consider(x1, y); }
  return { azimuth, elevation, halfU, halfV };
}

/**
 * Grows a seed box until its own border stands in sky.
 *
 * A window cut through the middle of a bank has cloud hard against its edges,
 * and a fade applied to that is a guillotine with a soft blade: it still draws a
 * straight line, it only draws it over seven pixels instead of one. The window
 * has to be somewhere the cloud has already ended, so it is pushed outwards
 * until it is — or until it runs out of frame, which is a different problem with
 * a different answer.
 *
 * @returns {{box: number[], border: number[], reached: boolean}}
 */
function growBox(seed, material, { quiet = 0.22, step = 8, limit = 120 } = {}) {
  // The coverage the separation read and the carry into the holes left, before
  // the layer had its say. Where a window stops is a DECISION, and a decision
  // taken on a number the layer moves is a composition that moves with it.
  const { decided: cutAlpha, ground } = material;
  const box = [...seed];
  const cover = (side) => {
    const list = [];
    const [x0, y0, x1, y1] = box;
    // Read with the blocks NOT skipped, on the coverage they were left with.
    //
    // This is the whole of the slab defect, and it is worth keeping the reason
    // written down now that the answer behind a block has changed. A side that
    // ran behind a monolith had almost no texel the photograph could show, so
    // the reading fell under the six it needs and the side was called quiet —
    // quiet meaning "nothing there", when what was there was solid cumulus with
    // a block in front of it. The window then stopped where it stood, the fade
    // guillotined the cloud at its border, and the result was a pale slab one
    // fade band wide, standing exactly where the block hid it at the reference
    // pose and uncovered by two steps sideways.
    //
    // What a block hides is now the carry: the photograph for a degree, and
    // nothing after it. So a side pushed into a hole reads the photograph's own
    // coverage while it is still within a degree of it and reads nothing beyond
    // — and a border standing where there is no coverage at all is a border with
    // nothing to guillotine, which is exactly what a window is pushed outwards
    // to find. The land is still skipped, because a block standing against the
    // land has no weather behind it to carry.
    const along = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = y * W + x;
      if (ground[i]) return;
      list.push(cutAlpha[i]);
    };
    if (side === 0) for (let y = y0; y <= y1; y += 2) along(x0, y);
    if (side === 1) for (let x = x0; x <= x1; x += 2) along(x, y0);
    if (side === 2) for (let y = y0; y <= y1; y += 2) along(x1, y);
    if (side === 3) for (let x = x0; x <= x1; x += 2) along(x, y1);
    // Off the frame, or wholly behind stone and land, there is nothing to
    // measure: such a side is quiet as far as the photograph can say, and the
    // continuation is what deals with it.
    if (list.length < 6) return 0;
    list.sort((p, q) => p - q);
    return list[Math.floor(list.length * 0.97)];
  };
  const grown = [0, 0, 0, 0];
  let moved = true;
  while (moved) {
    moved = false;
    for (let side = 0; side < 4; side++) {
      if (grown[side] >= limit) continue;
      if (cover(side) <= quiet) continue;
      box[side] += side < 2 ? -step : step;
      grown[side] += step;
      moved = true;
    }
  }
  return {
    box,
    border: [0, 1, 2, 3].map(cover),
    grown,
  };
}

/** Screen pixels per unit of a tile's own tangent coordinate, across the tile. */
function screenRate(azimuth, elevation, halfU, halfV) {
  const project = makeProjector();
  const { c, right, up } = tileBasis(azimuth, elevation);
  const at = (u, v) => {
    const d = [c[0] + u * right[0] + v * up[0], c[1] + u * right[1] + v * up[1],
      c[2] + u * right[2] + v * up[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    return project([d[0] / len, d[1] / len, d[2] / len]);
  };
  const h = 1e-3;
  const u = [];
  const v = [];
  for (const su of [-0.8, 0, 0.8]) {
    for (const sv of [-0.8, 0, 0.8]) {
      const p = at(su * halfU, sv * halfV);
      const pu = at(su * halfU + h, sv * halfV);
      const pv = at(su * halfU, sv * halfV + h);
      if (!p || !pu || !pv) continue;
      u.push(Math.hypot(pu[0] - p[0], pu[1] - p[1]) / h);
      v.push(Math.hypot(pv[0] - p[0], pv[1] - p[1]) / h);
    }
  }
  const mid = (list) => [...list].sort((a, b) => a - b)[list.length >> 1];
  return {
    u: mid(u), v: mid(v), uMin: Math.min(...u), uMax: Math.max(...u),
  };
}

/** Cuts one tile out of the reference, marking what the reference could not show. */
function cutTile(spec, material) {
  const { cutAlpha: alpha, cutColour: colour, ground, completed } = material;
  const project = makeProjector();
  const base = windowOf(spec.box);
  // The window a tile is written into is its box, grown only by the fade it has
  // to die inside. Room for a bank to carry on past the edge of the photograph
  // is asked for in the box itself — a box may reach outside the frame, and
  // what it finds there is marked as continuation — because a margin added on
  // every side to buy room on one is a margin paid for four times.
  const halfU = base.halfU / (1 - EDGE_FADE);
  const halfV = base.halfV / (1 - EDGE_FADE);
  const azimuth = base.azimuth;
  const elevation = base.elevation;
  const { c, right, up } = tileBasis(azimuth, elevation);

  const rate = RATE[spec.kind] ?? RATE.mass;
  const screen = screenRate(azimuth, elevation, halfU, halfV);
  const width = Math.max(16, Math.round(2 * halfU * screen.u * rate / 4) * 4);
  const height = Math.max(16, Math.round(2 * halfV * screen.v * rate / 4) * 4);

  const a = new Float32Array(width * height);
  const rgb = new Float32Array(width * height * 3);
  // 1 where the reference measured this texel, 0 where it has to be invented.
  const known = new Uint8Array(width * height);
  // 1 where the material is a continuation past the picture rather than a hole
  // inside it: past the frame, or behind the land.
  const beyond = new Uint8Array(width * height);
  // 1 where NOBODY PHOTOGRAPHED THIS, whichever of the two it is.
  //
  // The mask above says only where this window ran out. Behind a block the
  // window did not run out — the frame carries the same answer to every window,
  // so the gather is safe and the texel reads as measured — and for three gates
  // running that was the one place the invention was not being counted as
  // invention. It is counted here, and the invariant that reads a straight edge
  // names it. What it counts now is the carry, which reaches a degree in and
  // stops; deeper in the hole there is no coverage to draw a line with.
  const invented = new Uint8Array(width * height);
  const dir = [0, 0, 0];

  for (let j = 0; j < height; j++) {
    const v = (1 - 2 * (j + 0.5) / height) * halfV;
    for (let i = 0; i < width; i++) {
      const u = (2 * (i + 0.5) / width - 1) * halfU;
      let len = 0;
      for (let k = 0; k < 3; k++) {
        dir[k] = c[k] + u * right[k] + v * up[k];
        len += dir[k] * dir[k];
      }
      len = Math.sqrt(len);
      for (let k = 0; k < 3; k++) dir[k] /= len;
      const o = j * width + i;
      const p = project(dir);
      if (!p) { beyond[o] = 1; invented[o] = 1; continue; }
      const [px, py] = p;
      if (px < 1 || py < 1 || px >= W - 2 || py >= H - 2) {
        beyond[o] = 1; invented[o] = 1; continue;
      }
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      // Where a block stands against the sky the frame carries one answer for
      // every window — the photograph for a degree and nothing after it — so the
      // gather is safe there and the texel counts as measured: not because
      // anybody measured it, but because every window that reaches it reads the
      // same thing, which is the property that matters. Where a block stands
      // against the land there is no weather to carry, and that is the
      // continuation's business.
      let onLand = false;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (ground[(y0 + dy) * W + x0 + dx]) onLand = true;
        }
      }
      if (onLand) { beyond[o] = 1; invented[o] = 1; continue; }
      if (completed && completed[y0 * W + x0]) invented[o] = 1;
      const fx = px - x0;
      const fy = py - y0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const q00 = y0 * W + x0;
      const q10 = q00 + 1;
      const q01 = q00 + W;
      const q11 = q01 + 1;
      a[o] = alpha[q00] * w00 + alpha[q10] * w10 + alpha[q01] * w01 + alpha[q11] * w11;
      for (let k = 0; k < 3; k++) {
        rgb[o * 3 + k] = colour[q00 * 3 + k] * w00 + colour[q10 * 3 + k] * w10
          + colour[q01 * 3 + k] * w01 + colour[q11 * 3 + k] * w11;
      }
      known[o] = 1;
    }
  }

  return {
    id: spec.id,
    kind: spec.kind,
    distinct: !!spec.distinct,
    holesOnly: !!spec.holesOnly,
    width,
    height,
    halfU,
    halfV,
    azimuth,
    elevation,
    // What the reference frame draws one of this tile's texels over, at the
    // reference pose: one is a unit resampling, and under one the sprite is
    // magnified and reads the coarsest thing it was written from.
    screenPerTexel: [screen.uMin / (width / (2 * halfU)), screen.uMax / (width / (2 * halfU))],
    a,
    rgb,
    known,
    beyond,
    invented,
  };
}

/**
 * Distance in texels to the nearest texel of a set, and which texel that was.
 *
 * The second answer is the one that matters here. A continuation past the edge
 * of the photograph has to inherit the coverage the photograph had at that edge,
 * or it is a slab: filled uniformly and then faded with height, what comes back
 * is a horizontal bank of cloud sitting over open blue with a ruled line between
 * them, which is precisely the thing this whole tool exists to avoid.
 */
function distanceTo(set, width, height, carry = null) {
  const BIG = 1e9;
  const dist = new Float32Array(width * height).fill(BIG);
  const from = carry ? new Int32Array(width * height).fill(-1) : null;
  for (let i = 0; i < width * height; i++) {
    if (!set[i]) continue;
    dist[i] = 0;
    if (from) from[i] = i;
  }
  const relax = (o, source, cost) => {
    const d = dist[source] + cost;
    if (d < dist[o]) { dist[o] = d; if (from) from[o] = from[source]; }
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * width + x;
      if (x > 0) relax(o, o - 1, 1);
      if (y > 0) relax(o, o - width, 1);
      if (x > 0 && y > 0) relax(o, o - width - 1, Math.SQRT2);
      if (x < width - 1 && y > 0) relax(o, o - width + 1, Math.SQRT2);
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const o = y * width + x;
      if (x < width - 1) relax(o, o + 1, 1);
      if (y < height - 1) relax(o, o + width, 1);
      if (x < width - 1 && y < height - 1) relax(o, o + width + 1, Math.SQRT2);
      if (x > 0 && y < height - 1) relax(o, o + width - 1, Math.SQRT2);
    }
  }
  return { dist, from };
}

/**
 * Carries a field smoothly out of the region it is known in.
 *
 * Asked for by the continuation, which has to inherit the coverage the
 * photograph had along the line it ran out at. Two ways of doing it were tried
 * and both drew what they were made of. Reading the nearest known texel is what
 * a distance transform does to a straight boundary: the answer is constant
 * across each cell of the Voronoi of that boundary, so the continuation came
 * back in rectangles with the cell walls between them. A pyramid, sampled at the
 * texel, draws its own levels instead — the same rectangles, in powers of two.
 *
 * This is a normalised convolution: the field times where it is known, and where
 * it is known, both blurred by the same kernel and then divided. Smooth
 * everywhere by construction, because a blur is, and it says the obvious thing —
 * a texel outside takes the average of the measurement in reach of it, weighted
 * by how near that measurement is.
 */
function extendOutwards(value, mask, width, height, radius) {
  const n = width * height;
  let v = new Float32Array(n);
  let w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    v[i] = value[i];
    w[i] = 1;
  }
  const line = new Float32Array(Math.max(width, height));
  const box = (buf, count, stride, base, r) => {
    for (let i = 0; i < count; i++) line[i] = buf[base + i * stride];
    let sum = 0;
    for (let i = 0; i <= r && i < count; i++) sum += line[i];
    for (let i = 0; i < count; i++) {
      const lo = i - r - 1;
      const hi = i + r;
      if (hi < count) sum += line[hi];
      if (lo >= 0) sum -= line[lo];
      const span = Math.min(count - 1, hi) - Math.max(0, lo + 1) + 1;
      buf[base + i * stride] = sum / span;
    }
  };
  // Three box passes: the third convolution of a box is near enough a Gaussian
  // that nothing in a sky can tell, and it is three adds a texel.
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < height; y++) {
      box(v, width, 1, y * width, radius);
      box(w, width, 1, y * width, radius);
    }
    for (let x = 0; x < width; x++) {
      box(v, height, width, x, radius);
      box(w, height, width, x, radius);
    }
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = w[i] > 1e-6 ? v[i] / w[i] : 0;
  // Inside the measurement the answer is the measurement, not a blur of it.
  for (let i = 0; i < n; i++) if (mask[i]) out[i] = value[i];
  v = null; w = null;
  return out;
}

/**
 * Carries a tile past the edge of the photograph, and then makes it end.
 *
 * Only past the edge. A hole a monolith left is not unknown to a window any more
 * — the frame answered it once, for every window, with the photograph's own rim
 * carried a degree in and nothing after that — so there is nothing here to fill
 * and no search is asked to. What lies past the picture IS unknown, and it is
 * filled and then brought down to nothing over the continuation, with the tail
 * cut rather than faded, so what is left is a torn rim of the material's own
 * making and not an ellipse of haze.
 */
function completeTile(tile) {
  const { width, height, a, rgb, known, beyond } = tile;
  const n = width * height;

  // Every measured texel may be copied from, cloud or not.
  //
  // Restricting the source to the cloudy ones is the obvious thing and it is
  // wrong, because it leaves the search no way to answer "nothing here": asked
  // for the sky past a frame whose last column is clear, it answers with the
  // only material it has, and what comes back is a bank where the picture
  // happened to stop. With the sky in the library the search decides, from the
  // neighbourhood, which of the two to carry on — which is the question it was
  // always being asked.
  const source = new Uint8Array(n);
  let sourceCount = 0;
  let level = 0;
  const levels = [];
  for (let i = 0; i < n; i++) {
    if (!known[i]) continue;
    source[i] = 1;
    sourceCount++;
    if (a[i] > 0.5) {
      levels.push((0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2]) / a[i]);
    }
  }
  levels.sort((x, y) => x - y);
  level = levels.length ? levels[levels.length >> 1] : 1;

  // The coverage and the premultiplied colour, for the reason carryIntoHoles
  // states: the quotient is the field that keeps the layer whole and it is not
  // the field a search can interpolate, because it has to be floored to exist
  // where there is no cloud and the floor is a contour of its own.
  const filled = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    filled[i * 4] = a[i];
    for (let k = 0; k < 3; k++) filled[i * 4 + 1 + k] = rgb[i * 3 + k];
  }
  const out = [0, 0, 0];
  if (sourceCount >= 600) {
    completeByExemplar({
      data: filled,
      known,
      source,
      width,
      height,
      channels: 4,
      seed: 0x0c10,
      radius: FILL.radius,
      levels: FILL.levels,
      iterations: FILL.iterations,
      // A coverage and a colour that do not describe one cloud between them are
      // not weather, they are arithmetic: settled at every round rather than
      // once at the end, because the closure moves the four by different amounts.
      settle: FILL.settle ? (i, data) => {
        const kept = settleCloud(
          data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3], level, out,
        );
        data[i * 4] = kept;
        for (let k = 0; k < 3; k++) data[i * 4 + 1 + k] = out[k];
      } : null,
    });
  }

  const reach = Math.max(4, Math.round(
    Math.tan(CONTINUATION_DEG * DEG) / (2 * tile.halfU) * width));
  const inside = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!beyond[i]) inside[i] = 1;
  const { dist: away } = distanceTo(inside, width, height);

  const boundary = extendOutwards(
    Float32Array.from({ length: n }, (v, i) => (beyond[i] ? 0 : filled[i * 4])), inside,
    width, height, Math.max(3, Math.round(reach * 0.22)),
  );

  // How far each invented texel is from anything anybody photographed. Both of
  // the treatments below are ramped by it, and both have to be: whatever is done
  // to the invention and not to the measurement is done differently on the two
  // sides of a line that runs round a monolith, and a monolith's silhouette is a
  // rectangle. Applied at full strength from the first texel, the tail cut alone
  // put a pale slab in the sky in the exact shape of the third block, with a
  // step in coverage down one side of it.
  const fromKnown = distanceTo(known, width, height).dist;

  // The search's own grain, softened with distance from the photograph.
  //
  // A patch search asked to invent tens of degrees of cumulus answers with a
  // weave: the same handful of turrets at the same spacing, which the eye finds
  // at once because nothing else in a sky repeats. What is near the measurement
  // is held — it has to meet it — and what is far from it is smoothed towards
  // its neighbourhood, so an invented region reads as soft distant cloud rather
  // than as a pattern.
  //
  // The ceiling the block holes are held under is deliberately NOT applied here,
  // and the reason is measured rather than argued. A hole is enclosed: whatever
  // is put in it is bounded on every side by the photograph, so a kernel wide
  // enough to kill its grain still has the photograph to take its level from.
  // The continuation is enclosed by nothing. Held under the same kernel it came
  // back as a pale wash spread over ten degrees of sky with a rectangular hole
  // in the middle of it where the near band ended — worse, and worse in exactly
  // the way this whole tool is about, than the grain it was meant to cure.
  {
    const src = Float32Array.from(filled);
    const span = Math.max(12, reach * 0.55);
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const o = j * width + i;
        if (known[o]) continue;
        const r = Math.min(14, Math.round(fromKnown[o] / span * 14));
        if (r < 1) continue;
        const acc = [0, 0, 0, 0];
        let count = 0;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const x = i + dx;
            const y = j + dy;
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const q = y * width + x;
            for (let k = 0; k < 4; k++) acc[k] += src[q * 4 + k];
            count++;
          }
        }
        for (let k = 0; k < 4; k++) filled[o * 4 + k] = acc[k] / count;
      }
    }
  }

  let synthesised = 0;
  for (let i = 0; i < n; i++) {
    let value = filled[i * 4];
    // The coverage the colour standing here is premultiplied by, kept before
    // anything below thins it.
    //
    // Everything that follows takes coverage away — the decay that ends a
    // continuation, and the tail cut — and every one of them has to take the
    // same share of the colour, or the colour a texel is asking a cloud for
    // climbs as it fades out. It did: the decay was applied to the coverage and
    // then the colour was renormalised against the DECAYED figure, which
    // divides the cloud's own colour by the decay. A texel two hundredths of
    // the way out was asking for a cloud a hundred times the sky, which is not
    // a cloud, it is a piece of sky that outlived its own coverage — the exact
    // thing this unit is about, standing in the tool that ends a bank.
    const carried = value;
    for (let k = 0; k < 3; k++) rgb[i * 3 + k] = filled[i * 4 + 1 + k];
    if (known[i]) { a[i] = value; continue; }
    if (beyond[i]) {
      // Away from the photograph the material is the search's, the shape is the
      // photograph's own edge carried outwards, and the ending is the decay.
      value *= smoothstep(reach, reach * 0.25, away[i])
        * smoothstep(0.04, 0.32, boundary[i]);
    }
    // And the invention's own tail is cut, from where the measurement ends.
    //
    // Where the reference measured, a texel of clear sky comes back as exactly
    // no cloud, because the separation floors it. A patch search has no such
    // floor: it answers a few per cent of coverage over whole degrees of sky it
    // has nothing to say about, and a few per cent of coverage still carries
    // colour and still costs the frame a blend. Measured on the hero, that skirt
    // was most of what the silhouette below has to enclose — the difference
    // between a cover that follows the cloud and one that is the window again.
    const tail = SYNTHETIC_TAIL * smoothstep(2, Math.max(14, reach * 0.3), fromKnown[i]);
    const kept = Math.max(0, (value - tail) / (1 - tail));
    const scale = carried > 1e-4 ? kept / carried : 0;
    for (let k = 0; k < 3; k++) rgb[i * 3 + k] *= scale;
    if (kept > THIN) synthesised++;
    a[i] = kept;
  }
  tile.measuredTexels = sourceCount;
  tile.synthesisedTexels = synthesised;
  tile.continuationTexels = reach;
  closeContinuation(tile, fromKnown);
}

// What a body of pure invention has to be standing on, and how big it has to be
// before anyone asks.
//
// A CONTINUATION IS A CONTINUATION OF SOMETHING. Past the edge of the photograph
// the bank goes on, and drawing it is what keeps a sprite from putting a horizon
// of its own across the sky; but every piece of what is drawn there has to be
// attached to the piece of cloud it continues. A body of solid cloud that stands
// past the frame touching nothing the photograph showed is not a continuation at
// all: it is the patch search's own answer to a question nobody asked, and this
// picture had one — a smooth tapering falx four degrees long, hanging over the
// hero bank in the client's own screenshot, with clear sky between it and the
// cloud it was supposed to be part of.
//
// Attachment is read on the SOLID, both sides. Two banks joined by a veil are two
// banks, and a veil is not what holds a turret up.
// And it is read on what a body IS, not only on what it is made of.
//
// The ninth gate found the falx still standing, and the reading above is why:
// it looked for bodies above half coverage and the falx is a PALE thing, a
// smooth tapering arc at a third; and it asked only whether the piece touched
// the photograph anywhere at all, which this one does, at a corner. Both of
// those are now stated the way the eye states them.
//
// A body is read wherever the invention is dense enough to have an outline
// against sky. It has to STAND on the photograph over a real front rather than
// at a point — a turret an inch wide does not hold up a bank four degrees long.
// And it has to be a HEAP: the same gate the library is chosen by, because a
// continuation is a bank going on and a bank is a heap. A bow pays for its whole
// bay, and the falx is a bow.
const CONTINUATION_SOLID = 0.28;
const CONTINUATION_MIN_SQDEG = 0.2;
const CONTINUATION_FOOT_DEG = 0.7;
const CONTINUATION_HEAP = 0.62;

// And how far the continuation may hold coverage away from any body at all.
//
// The tenth gate found a third shape, and it is the one the reading above is
// blind to by construction. Everything above asks about BODIES — pieces dense
// enough to be a turret or a bow — and the shape it found has no body: a pale
// hook two degrees across, hanging in clean sky past the right edge of the
// photograph, whose coverage peaks at 0.157 and never once reaches the 0.28 the
// test starts looking at. It is not a piece of invented cloud. It is the patch
// search's own field, cut at the tail and left as the contour of its own level
// set, which is a smooth closed curve, which is exactly what the eye picks out
// of an empty sky.
//
// So the continuation carries coverage only within reach of something that is
// actually there. Measured across the whole bake, every other tile keeps its
// continuation inside half a degree of a body and none of them has a texel past
// one; hero-east has two hundred and forty four, and they are the hook. The
// distance is the tool's own: the same degree that closeContinuation already
// calls "a degree either side of a body that was never there".
const CONTINUATION_REACH_DEG = 1;

/**
 * Takes away the bodies of the continuation that continue nothing.
 *
 * The pieces that fail are not cut, they are dissolved: the coverage is scaled
 * to nothing over the piece and back to itself a little way outside it, so what
 * is left where the falx was is the same thin invention as the sky around it,
 * ending as that sky ends. A cut would be one more straight edge, which is the
 * thing this whole tool is about.
 */
function closeContinuation(tile, fromKnown) {
  const {
    width, height, a, rgb, known, beyond,
  } = tile;
  const n = width * height;
  const perDegree = width / (2 * Math.atan(tile.halfU) / DEG);
  const minTexels = CONTINUATION_MIN_SQDEG * perDegree * perDegree;

  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = (beyond[i] && !known[i] && a[i] > CONTINUATION_SOLID) ? 1 : 0;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const doomed = new Uint8Array(n);
  const dropped = [];
  for (let start = 0; start < n; start++) {
    if (!solid[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    const piece = [];
    let anchored = 0;
    while (top > 0) {
      const p = stack[--top];
      piece.push(p);
      const py = (p / width) | 0;
      const px = p - py * width;
      for (const q of [px > 0 ? p - 1 : -1, px < width - 1 ? p + 1 : -1,
        py > 0 ? p - width : -1, py < height - 1 ? p + width : -1]) {
        if (q < 0) continue;
        // Standing on the photograph's own body is what makes it a continuation.
        if (!beyond[q] && a[q] > CONTINUATION_SOLID) anchored++;
        if (seen[q] || !solid[q]) continue;
        seen[q] = 1;
        stack[top++] = q;
      }
    }
    if (piece.length < minTexels) continue;
    // How much of its own envelope it fills, along both axes: a heap pays
    // almost nothing because there is nothing between its two edges but itself,
    // and a bow pays for its whole bay. The worse axis is the answer, because a
    // bow on its side is still a bow.
    let x0 = width;
    let x1 = -1;
    let y0 = height;
    let y1 = -1;
    for (const p of piece) {
      const py = (p / width) | 0;
      const px = p - py * width;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const box = new Uint8Array(bw * bh);
    for (const p of piece) {
      const py = (p / width) | 0;
      box[(py - y0) * bw + (p - py * width - x0)] = 1;
    }
    let spannedRows = 0;
    let spannedCols = 0;
    for (let j = 0; j < bh; j++) {
      let first = -1;
      let last = -1;
      for (let i = 0; i < bw; i++) if (box[j * bw + i]) { if (first < 0) first = i; last = i; }
      if (first >= 0) spannedRows += last - first + 1;
    }
    for (let i = 0; i < bw; i++) {
      let first = -1;
      let last = -1;
      for (let j = 0; j < bh; j++) if (box[j * bw + i]) { if (first < 0) first = j; last = j; }
      if (first >= 0) spannedCols += last - first + 1;
    }
    const fill = piece.length / Math.max(1, Math.max(spannedRows, spannedCols));
    const footing = anchored / Math.max(1, perDegree);
    if (footing >= CONTINUATION_FOOT_DEG && fill >= CONTINUATION_HEAP) continue;
    for (const p of piece) doomed[p] = 1;
    dropped.push({
      texels: piece.length,
      footing: round(footing, 2),
      fill: round(fill, 2),
      sqdeg: round(piece.length / (perDegree * perDegree), 2),
    });
  }
  tile.continuationDropped = dropped;

  // And the coverage that never becomes a body at all: whatever the continuation
  // holds further than its reach from anything solid. The bodies that just
  // failed are not solid for this purpose — a falx may not hold up its own
  // skirt — and the photograph's own material is, wherever it stands.
  const reach = CONTINUATION_REACH_DEG * perDegree;
  const standing = new Uint8Array(n);
  for (let i = 0; i < n; i++) standing[i] = (a[i] > CONTINUATION_SOLID && !doomed[i]) ? 1 : 0;
  const { dist: fromBody } = distanceTo(standing, width, height);
  let stranded = 0;
  for (let i = 0; i < n; i++) {
    if (!beyond[i] || known[i] || a[i] <= TAIL_CUT || fromBody[i] <= reach) continue;
    doomed[i] = 1;
    stranded++;
  }
  tile.continuationStranded = stranded;

  if (!dropped.length && !stranded) return;

  // Out to where the sky round it is thin invention anyway. A degree either side
  // of a body that was never there is a degree of nothing.
  const band = Math.max(4, Math.round(perDegree));
  const { dist } = distanceTo(doomed, width, height);
  for (let i = 0; i < n; i++) {
    if (dist[i] > band || known[i]) continue;
    const keep = smoothstep(0, band, dist[i]);
    // And it only ever takes away what the photograph could not show: a texel
    // near the falx that the frame did measure is left exactly as measured.
    const held = keep + (1 - keep) * smoothstep(2, 0, fromKnown[i]);
    a[i] *= held;
    for (let k = 0; k < 3; k++) rgb[i * 3 + k] *= held;
  }
}

// --------------------------------------------------------------------- a veil

// The photograph's own sky, wherever the weather is not standing in front of it.
//
// The dome is the clean model and it is clean on purpose: the photograph's own
// departures, fitted into it, put blotches across the whole sphere and the
// client saw them. But those departures are real — the frame's upper left is a
// blue this model renders pale, and the sky over the banks is bluer still — and
// with the dome cleaned, nothing was carrying them. Measured at the reference
// pose, the error left on the sky the weather does NOT cover was 6.7 of DeltaE
// against 2.4 on the weather itself: the frame's remaining fault was almost all
// of it in the places where nothing had been laid.
//
// So it is carried the way everything else in this frame is carried — as a
// photographic sprite, standing inside the sector the photograph owns and
// nowhere else. What makes it a veil rather than a cloud somebody forgot to cut
// is stated three ways and enforced three ways: it is read at a FEW TEXELS PER
// DEGREE, so it can hold no rim and no turret; its coverage is CAPPED, so a
// departure that asks for more than a veil's worth is refused rather than
// smuggled in as one; and it barely DRIFTS, because a veil that slid would take
// the photograph's own sky off the photograph.
const VEIL_PX_PER_DEG = 3.2;

// Where the greeting stands in the reference framing, in its own pixels: the
// interface's own box for `.hud-welcome`, measured in the page.
//
// A round three hundred square was what the frame level test used as a generous
// superset of it, and that superset is too generous to be an invariant — the
// left bank of the photograph legitimately stands in its lower right corner, and
// stood there at the eighth gate too, which is why the byte identity that test
// reported was never quite what it looked like.
const WELCOME = [40, 41, 245, 263];

// How much weather is allowed to reach it.
//
// Not none, and that is a finding rather than a decision. The frame level test
// this replaces compared a render with the field against one without it over a
// round three hundred square and called the corner byte identical; run over the
// build the EIGHTH GATE SHIPPED it is not, and was not — 319 of the greeting's
// own 45510 pixels move when the field is taken away, by eight levels at the
// worst of them. The left bank of the photograph grazes the bottom right corner
// of the text's bounding box, where there is no text, at five hundredths of
// coverage.
//
// So the bound is the graze that was already there, written down. It is not a
// licence for more: anything that puts a body of cloud into the greeting fails
// here, and so does anything that lets this one grow.
const WELCOME_WEATHER = 0.12;

// How far past the frame it goes on before it is nothing.
//
// Far further than a mass continues, and the lateral walk is what says so. A
// mass ends where its own cloud ends, which is a shape; a veil has no shape to
// end at, so its ending is a gradient and the only question is how steep. The
// photograph's upper left asks for half its light back, and brought to nothing
// over the seven degrees a mass uses that is three per cent of the sky's
// brightness per degree — which from six metres to the west came out as exactly
// what the client reported the first time: a dark rectangle reaching up the left
// of the frame. Over twenty it is under one per cent a degree, which is less
// than the model's own gradient carries, and the ending cannot be found.
//
// Wider across than up, because the two endings are not the same problem. Across
// is where the walk goes: turning the head is what brings the frame's own side
// into the middle of the view, and it is the one the client found. Upwards the
// frame already ends near the top of the weather, and every degree spent up
// there is atlas bought to fade nothing into nothing.
const VEIL_MARGIN_AZ = 20;
const VEIL_MARGIN_EL = 12;

// The most coverage a veil may carry. Past this it is not a veil, and the bake
// says how much it had to refuse rather than quietly clipping it.
const VEIL_MAX = 0.45;

// How much sky has to be left showing for the reading to mean anything.
//
// The correction wanted is the shortfall divided by what still shows through the
// weather, and under a sprite that covers nearly everything that is a small
// difference over a small number: noise, amplified. Those texels are not read at
// all — and they need no reading, because a sprite that covers everything is
// already returning the photograph by itself.
const VEIL_CLEAR = 0.25;

// How wide the reading is spread before it is believed.
//
// This is the one number that makes a veil a veil, and it earns that by doing
// three jobs with one operation. The samples are laid down where the photograph
// gave them and then convolved — numerator and denominator both — with a kernel
// this wide, so that what comes out is the LOW FREQUENCY of the shortfall and
// can hold no rim, no turret and no edge; the places the photograph could not
// answer are filled by the same stroke, because a weight of nothing contributes
// nothing and the ratio is still the neighbourhood's own; and the field carries
// on smoothly past the frame for as far as the kernel reaches, which is further
// than the continuation needs.
//
// Filling by pushing the rim outwards instead — the obvious thing, and what this
// did first — put the blocks back in the sky: a monolith's hole came out as a
// FLAT slab of coverage in the exact shape of the monolith, with a hard edge all
// round it, which is the one artefact this whole tool exists to prevent. There
// is no threshold here and no boundary anywhere, which is why.
// Wider across than up, and that is the shape of the fault it is correcting. A
// sky's own structure runs with HEIGHT — it deepens away from the horizon and
// away from its sun — so height is where a correction may keep detail. Across
// bearing it must not: the photograph's departure from the model is concentrated
// in the west of the frame, and read at the same sharpness in both axes it comes
// out as an isolated dark LENS hanging in the sky, which is not a thing a sky
// does and is precisely the blotch this architecture took out of the dome.
// Smoothed four times as hard across as up, what is left is a gradient.
const VEIL_SMOOTH_DEG = 3.0;
const VEIL_SMOOTH_AZ_DEG = 13;

// And the width the CONTINUATION is spread by, which has to be a second number.
//
// A normalised convolution answers only as far as its own kernel reaches, and at
// that reach it stops answering all at once: the weight underneath it goes to
// nothing while the ratio riding on it is still a full strength reading, so the
// field falls off a cliff exactly there. Ten degrees out from the frame, with a
// fifth of the ending still to run, that cliff came out as a quarter of coverage
// across five pixels and the lateral reading found it at once.
//
// So the far field is read with a kernel wide enough that its own reach is past
// where the ending has finished, and the near one is faded into it on the near
// one's own weight — which is nothing exactly where it stops being trustworthy.
// Two smooth fields and a smooth blend: there is no reach anywhere to fall off.
const VEIL_REACH_DEG = 9;

/** A separable Gaussian, zero outside, over a field of the tile's own grid. */
function smear(field, width, height, sigmaU, sigmaV, channels = 1) {
  const pass = (src, along, sigma) => {
    const radius = Math.max(1, Math.ceil(sigma * 3));
    const kernel = new Float64Array(2 * radius + 1);
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      kernel[k + radius] = Math.exp(-(k * k) / (2 * sigma * sigma));
      sum += kernel[k + radius];
    }
    for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;
    const out = new Float64Array(src.length);
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        for (let c = 0; c < channels; c++) {
          let acc = 0;
          for (let k = -radius; k <= radius; k++) {
            const x = along ? i + k : i;
            const y = along ? j : j + k;
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            acc += src[(y * width + x) * channels + c] * kernel[k + radius];
          }
          out[(j * width + i) * channels + c] = acc;
        }
      }
    }
    return out;
  };
  return pass(pass(field, true, sigmaU), false, sigmaV);
}

/**
 * The composition drawn at the reference framing, colour as well as coverage.
 *
 * What the frame ALREADY stands in front of the dome, so that the veil can be
 * asked for the one thing left over instead of for the whole sky. Far first and
 * premultiplied, the same order and the same arithmetic the frame uses.
 */
function frameField(field) {
  const cover = new Float32Array(W * H);
  const colour = new Float32Array(W * H * 3);
  const rgb = [0, 0, 0];
  for (const sprite of field) {
    const { tile } = sprite;
    const { c, right, up } = tileBasis(sprite.azimuth, sprite.elevation);
    const { live, cols, rows } = tile.silhouette;
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const r = ray(px, py);
        const w = r[0] * c[0] + r[1] * c[1] + r[2] * c[2];
        if (w <= 1e-3) continue;
        const u = (r[0] * right[0] + r[1] * right[1] + r[2] * right[2]) / w / sprite.halfU;
        const v = (r[0] * up[0] + r[1] * up[1] + r[2] * up[2]) / w / sprite.halfV;
        if (u < -1 || u > 1 || v < -1 || v > 1) continue;
        const col = Math.min(cols - 1, Math.floor((u + 1) / 2 * cols));
        const row = Math.min(rows - 1, Math.floor((1 - v) / 2 * rows));
        if (!live[row * cols + col]) continue;
        const a = readTile(tile, (u + 1) / 2 * tile.width, (1 - v) / 2 * tile.height, rgb);
        if (a <= 0) continue;
        const o = py * W + px;
        for (let k = 0; k < 3; k++) colour[o * 3 + k] = rgb[k] + colour[o * 3 + k] * (1 - a);
        cover[o] = a + cover[o] * (1 - a);
      }
    }
  }
  return { cover, colour };
}

/**
 * Cuts the veil: what the frame still owes the photograph once the weather is up.
 *
 * The arithmetic is forced rather than chosen. A sprite laid behind the whole
 * composition returns, at a pixel the composition covers by M with colour C,
 *
 *     C + (colour + dome(1 - a))(1 - M),
 *
 * and the frame today returns C + dome(1 - M). So the veil has to supply exactly
 * (reference - today)/(1 - M) as its own difference from the dome, which is the
 * ordinary cut every other tile here is made with — and it goes to nothing by
 * itself wherever the weather already carries the photograph, with no seam and
 * no rule to say where the weather ends.
 *
 * The coverage follows from the colour and not the other way round: what is
 * stored is premultiplied and cannot go negative, so a sky the model draws too
 * BRIGHT can only be brought down by covering it. The least coverage that does
 * it is the most any channel is over, and that is what the veil carries.
 */
function cutVeil(material, field) {
  const { radiance, dome, stone, ground } = material;
  const drawn = frameField(field);
  const clear = [0, 0, 0];
  const want = [0, 0, 0];

  // The window: the frame's own bearings, and the frame's own sky in height,
  // read off the picture rather than assumed. Below the skyline there is no sky
  // to carry and above the frame there is no photograph of it.
  let elMin = 90;
  let elMax = -90;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      if (stone[i] || ground[i]) continue;
      const el = Math.asin(Math.max(-1, Math.min(1, ray(px, py)[1]))) / DEG;
      if (el < elMin) elMin = el;
      if (el > elMax) elMax = el;
    }
  }
  const halfAz = POSE_WINDOW.azMax + VEIL_MARGIN_AZ;
  const elLow = elMin - VEIL_MARGIN_EL;
  const elHigh = elMax + VEIL_MARGIN_EL;
  const elevation = (elLow + elHigh) / 2;
  // Grown by the fade it has to die inside, exactly as a mass's window is.
  const halfU = Math.tan(halfAz * DEG) / (1 - EDGE_FADE);
  const halfV = Math.tan((elHigh - elLow) / 2 * DEG) / (1 - EDGE_FADE);
  const width = Math.round(2 * halfAz * VEIL_PX_PER_DEG / (1 - EDGE_FADE) / 4) * 4;
  const height = Math.round((elHigh - elLow) * VEIL_PX_PER_DEG / (1 - EDGE_FADE) / 4) * 4;
  // The frame's own bearings, as the thing the ending is measured from.
  const frame = {
    az: POSE_WINDOW.azMax, elMin, elMax,
  };

  const n = width * height;
  const a = new Float32Array(n);
  const rgb = new Float32Array(n * 3);
  const known = new Uint8Array(n);
  const beyond = new Uint8Array(n);
  const sumA = new Float64Array(n);
  const sumC = new Float64Array(n * 3);
  const sumW = new Float64Array(n);
  const { c, right, up } = tileBasis(0, elevation);
  const elevationOf = new Float64Array(width * height);

  // Which texels the photograph reaches at all — including the holes its blocks
  // punch in it, because a hole inside the picture is not the end of the picture
  // and a veil that faded into one would draw the block's own rectangle.
  const inFrame = new Uint8Array(n);
  let refused = 0;
  let asked = 0;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      if (ground[i]) continue;
      const r = ray(px, py);
      const w = r[0] * c[0] + r[1] * c[1] + r[2] * c[2];
      if (w <= 1e-3) continue;
      const u = (r[0] * right[0] + r[1] * right[1] + r[2] * right[2]) / w / halfU;
      const v = (r[0] * up[0] + r[1] * up[1] + r[2] * up[2]) / w / halfV;
      if (u < -1 || u > 1 || v < -1 || v > 1) continue;
      const ti = Math.min(width - 1, Math.max(0, Math.floor((u + 1) / 2 * width)));
      const tj = Math.min(height - 1, Math.max(0, Math.floor((1 - v) / 2 * height)));
      const o = tj * width + ti;
      inFrame[o] = 1;
      if (stone[i]) continue;
      const cover = drawn.cover[i];
      const shows = 1 - cover;
      if (shows < VEIL_CLEAR) continue;
      dome(r, clear);
      let need = 0;
      for (let k = 0; k < 3; k++) {
        // What the frame draws here now, and what it owes the photograph, put
        // back on the scale of the sky that is still showing through.
        const now = drawn.colour[i * 3 + k] + clear[k] * shows;
        want[k] = (radiance[i * 3 + k] - now) / shows;
        need = Math.max(need, -want[k] / Math.max(1e-5, clear[k]));
      }
      asked++;
      if (need > VEIL_MAX) refused++;
      const av = Math.max(0, Math.min(VEIL_MAX, need));
      sumA[o] += av * shows;
      for (let k = 0; k < 3; k++) {
        sumC[o * 3 + k] += Math.max(0, want[k] + clear[k] * av) * shows;
      }
      sumW[o] += shows;
    }
  }
  for (let i = 0; i < n; i++) known[i] = sumW[i] > 0 ? 1 : 0;
  for (let i = 0; i < n; i++) beyond[i] = inFrame[i] ? 0 : 1;

  // Numerator and denominator through the same kernel, and the answer is their
  // ratio: the neighbourhood's own reading wherever the photograph gave one, and
  // still the neighbourhood's own reading where it gave none.
  const su = VEIL_SMOOTH_AZ_DEG * VEIL_PX_PER_DEG;
  const sv = VEIL_SMOOTH_DEG * VEIL_PX_PER_DEG;
  const wide = smear(sumW, width, height, su, sv);
  const wideA = smear(sumA, width, height, su, sv);
  const wideC = smear(sumC, width, height, su, sv, 3);
  const fu = VEIL_REACH_DEG * VEIL_PX_PER_DEG;
  const far = smear(sumW, width, height, Math.max(su, fu), fu);
  const farA = smear(sumA, width, height, Math.max(su, fu), fu);
  const farC = smear(sumC, width, height, Math.max(su, fu), fu, 3);
  // What counts as an answer at all: a thousandth of the weight a texel in the
  // open carries, past which the ratio is one far rim sample against nothing.
  let peak = 0;
  for (let i = 0; i < n; i++) if (wide[i] > peak) peak = wide[i];
  const floor = peak * 1e-3;
  let peakFar = 0;
  for (let i = 0; i < n; i++) if (far[i] > peakFar) peakFar = far[i];
  const floorFar = peakFar * 1e-4;

  // Then everything the photograph never showed decays, measured in DEGREES from
  // the PICTURE'S OWN BEARINGS. Both halves of that matter. From the picture, so
  // a block's hole — which is inside the picture — decays not at all. And in
  // degrees, because this window is a tangent plane: a texel at its rim spans a
  // third of the sky a texel at its centre does, so an ending counted in texels
  // is three times as steep out there as it is in the middle, and out there is
  // exactly where it is on show.
  const dir = [0, 0, 0];
  const value = new Float64Array(n * 4);
  const away = new Float64Array(n);
  const live = new Uint8Array(n);
  // Where every texel of this window looks, and the reading there, before
  // anything is decided about how it should end.
  for (let j = 0; j < height; j++) {
    const v = (1 - 2 * (j + 0.5) / height) * halfV;
    for (let i = 0; i < width; i++) {
      const o = j * width + i;
      if (far[o] <= floorFar) continue;
      const u = (2 * (i + 0.5) / width - 1) * halfU;
      let len = 0;
      for (let k = 0; k < 3; k++) {
        dir[k] = c[k] + u * right[k] + v * up[k];
        len += dir[k] * dir[k];
      }
      len = Math.sqrt(len);
      for (let k = 0; k < 3; k++) dir[k] /= len;
      const el = Math.asin(Math.max(-1, Math.min(1, dir[1]))) / DEG;
      const az = Math.atan2(dir[0], -dir[2]) / DEG;
      away[o] = Math.max(
        (Math.abs(az) - frame.az) / VEIL_MARGIN_AZ,
        (el - frame.elMax) / VEIL_MARGIN_EL,
        (frame.elMin - el) / VEIL_MARGIN_EL,
      );
      elevationOf[o] = el;
      if (away[o] >= 1) continue;
      live[o] = 1;
      // The near reading where it is trustworthy, the far one where it is not,
      // and the near one's own weight is what says which.
      const t = smoothstep(floor * 4, floor * 40, wide[o]);
      const near = wide[o] > 0 ? wideA[o] / wide[o] : 0;
      value[o * 4] = farA[o] / far[o] + (near - farA[o] / far[o]) * t;
      for (let k = 0; k < 3; k++) {
        const fc = farC[o * 3 + k] / far[o];
        const nc = wide[o] > 0 ? wideC[o * 3 + k] / wide[o] : 0;
        value[o * 4 + 1 + k] = fc + (nc - fc) * t;
      }
    }
  }

  // What the photograph can honestly say about the sky it never showed.
  //
  // Not this, at that bearing: past the frame there is no photograph, and
  // carrying the frame's own upper left outwards is how a local darkness becomes
  // a DARK PATCH PINNED TO A BEARING — which is the exact fault that was taken
  // out of the dome, put back in a sprite. From six metres to the west, with the
  // frame's corner swung into the middle of the view, it read as a dark ellipse
  // hanging in clear sky, and no amount of capping it made it anything else.
  //
  // What the photograph can say is what it found AT THAT HEIGHT, across all the
  // bearings it saw. So outside the frame the reading relaxes to its own band —
  // uniform in bearing, which is the one shape a sky correction can have without
  // being somewhere — and only then goes to nothing.
  const BANDS = 96;
  const bandSum = new Float64Array(BANDS * 4);
  const bandW = new Float64Array(BANDS);
  const bandOf = (el) => Math.max(0, Math.min(BANDS - 1,
    Math.round((el - elLow) / (elHigh - elLow) * (BANDS - 1))));
  for (let i = 0; i < n; i++) {
    if (!live[i] || away[i] > 0) continue;
    const b = bandOf(elevationOf[i]);
    for (let k = 0; k < 4; k++) bandSum[b * 4 + k] += value[i * 4 + k];
    bandW[b] += 1;
  }
  // Bands the frame never reached take the nearest one that it did, so the
  // relaxation is defined over the whole window.
  const band = new Float64Array(BANDS * 4);
  for (let b = 0; b < BANDS; b++) {
    let q = b;
    let best = Infinity;
    for (let k = 0; k < BANDS; k++) {
      if (bandW[k] > 0 && Math.abs(k - b) < best) { best = Math.abs(k - b); q = k; }
    }
    if (bandW[q] > 0) for (let k = 0; k < 4; k++) band[b * 4 + k] = bandSum[q * 4 + k] / bandW[q];
  }

  for (let i = 0; i < n; i++) {
    if (!live[i]) continue;
    const keep = smoothstep(1, 0, away[i]);
    if (keep <= 0) continue;
    // Relaxed to its band over the first part of the ending, so that what is
    // still standing when the fade begins has no bearing of its own left.
    const flat = smoothstep(0, 0.45, Math.max(0, away[i]));
    const b = bandOf(elevationOf[i]);
    a[i] = (value[i * 4] + (band[b * 4] - value[i * 4]) * flat) * keep;
    for (let k = 0; k < 3; k++) {
      rgb[i * 3 + k] = (value[i * 4 + 1 + k]
        + (band[b * 4 + 1 + k] - value[i * 4 + 1 + k]) * flat) * keep;
    }
  }

  return {
    id: 'veil',
    kind: 'veil',
    width,
    height,
    halfU,
    halfV,
    azimuth: 0,
    elevation,
    screenPerTexel: [W / (2 * POSE_WINDOW.azMax) / VEIL_PX_PER_DEG,
      W / (2 * POSE_WINDOW.azMax) / VEIL_PX_PER_DEG],
    a,
    rgb,
    known,
    // A veil never reads the completion behind a block — the blocks are skipped
    // where it is read, and what fills their place is the same wide convolution
    // that fills everything else about it. So what it invented is what it
    // carried past the frame, and nothing else.
    invented: beyond,
    beyond,
    grown: [0, 0, 0, 0],
    measuredTexels: known.reduce((t, v) => t + v, 0),
    synthesisedTexels: 0,
    continuationTexels: Math.round(VEIL_MARGIN_AZ * VEIL_PX_PER_DEG),
    veilAsked: asked,
    veilRefused: refused,
  };
}

/**
 * Makes the veil end, without ever asking it to look like cloud.
 *
 * The fade and the tail cut are the window's, unchanged. What is deliberately
 * NOT here is the hue clamp a mass puts on its invented texels: that rule says a
 * cloud is white with a blue shadow, which is true of a cloud and is exactly
 * wrong for a piece whose entire job is to be the blue the model got wrong.
 */
function closeVeil(tile) {
  const {
    width, height, a, rgb,
  } = tile;
  const band = [Math.round(width * EDGE_FADE), Math.round(height * EDGE_FADE)];
  const sides = [[], [], [], []];
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const v = a[j * width + i];
      if (i < band[0]) sides[0].push(v);
      if (j < band[1]) sides[1].push(v);
      if (i >= width - band[0]) sides[2].push(v);
      if (j >= height - band[1]) sides[3].push(v);
    }
  }
  tile.fadeBandCover = sides.map((list) => {
    if (!list.length) return 0;
    list.sort((p, q) => p - q);
    return list[Math.floor(list.length * 0.99)];
  });

  for (let j = 0; j < height; j++) {
    const t = Math.min((j + 0.5) / height, 1 - (j + 0.5) / height) * 2;
    const fadeV = smoothstep(0, EDGE_FADE, t);
    for (let i = 0; i < width; i++) {
      const s = Math.min((i + 0.5) / width, 1 - (i + 0.5) / width) * 2;
      const fade = fadeV * smoothstep(0, EDGE_FADE, s);
      const o = j * width + i;
      const tail = TAIL_CUT * (1 - fade);
      const held = Math.max(0, Math.min(1, a[o])) * fade;
      const cut = Math.max(0, (held - tail) / (1 - tail));
      const scale = a[o] > 1e-4 ? cut / a[o] : 0;
      a[o] = cut;
      for (let k = 0; k < 3; k++) rgb[o * 3 + k] *= scale;
    }
  }

  let border = 0;
  for (let i = 0; i < width; i++) border = Math.max(border, a[i], a[(height - 1) * width + i]);
  for (let j = 0; j < height; j++) {
    border = Math.max(border, a[j * width], a[j * width + width - 1]);
  }
  tile.borderAlpha = border;
  tile.insetPercent = [0, 0, 0, 0];
}

/** A tile's window as a thing directions can be tested against. */
function windowOfTile(tile) {
  return { ...tileBasis(tile.azimuth, tile.elevation), halfU: tile.halfU, halfV: tile.halfV };
}

/**
 * How much of a window a direction stands inside: one deep in it, nought
 * outside it, and the fade in between.
 */
function windowWeight(window, dir) {
  const w = dir[0] * window.c[0] + dir[1] * window.c[1] + dir[2] * window.c[2];
  if (w <= 1e-6) return 0;
  const u = (dir[0] * window.right[0] + dir[1] * window.right[1] + dir[2] * window.right[2])
    / w / window.halfU;
  const v = (dir[0] * window.up[0] + dir[1] * window.up[1] + dir[2] * window.up[2])
    / w / window.halfV;
  if (Math.abs(u) >= 1 || Math.abs(v) >= 1) return 0;
  return smoothstep(0, EDGE_FADE, 1 - Math.abs(u)) * smoothstep(0, EDGE_FADE, 1 - Math.abs(v));
}

/**
 * The window, and the proof that it is one.
 *
 * The field is faded over the outer 14% of each half extent and the tail is then
 * cut, so the coverage reaches nothing before the border rather than at it. What
 * this records is what the fade actually achieved: the border's own coverage,
 * and how far in from each side the material really stops.
 *
 * The other thing it does is SHARE. Every mass stands where it was cut from and
 * carries the reference's own material, and the masses' windows overlap: eight
 * of them were each pushed outwards until their own border stood in sky, which
 * is a rule about where a window ends and not about where its neighbour begins.
 * Two pieces of the same material laid over one another do not composite back
 * to that material — premultiplied, coverage a over coverage a returns
 * a(2 − a), which at a third is a half — and the frame showed it: the boxes the
 * map draws round the masses read 7, 8 and 13 points of coverage above the
 * reference exactly where two or three windows stood over them, and read true
 * everywhere one did.
 *
 * So a texel's coverage is shared out between the windows that reach it, as
 * a_i = 1 − (1 − a·h)^{w_i}, where h is how much window stands over it at all
 * (the fades, capped at one) and the w_i are each window's part of that, summing
 * to one. It composites back to a·h EXACTLY, for any number of windows and any
 * split: the "over" of layers that all carry the same colour multiplies their
 * transparencies, and (1−a·h)^{Σw} = (1−a·h). Where a single window reaches,
 * h is its own fade and w is one, and the arithmetic is the multiplication it
 * always was — which is what keeps the guillotine fade biting on solid cloud at
 * a lone border, where an exponent alone would not have touched it.
 */
function closeWindow(tile, masses, ceiling) {
  const { width, height, a, rgb, known } = tile;
  // A piece of the library is matted by its own coverage inside an ellipse,
  // rather than by the rectangle it was cut in.
  //
  // A mass keeps its rectangle because a mass stands where it was cut and its
  // window was pushed out until its border stood in sky. A library piece cannot:
  // this photograph contains three square windows of cloud with sky on all four
  // sides, and a far field built out of three clouds is a far field with three
  // clouds in it. So a piece is allowed to have cloud at its border, and the
  // border is taken away radially — with the tail cut rather than faded, which
  // is the whole difference between the two. A fade dims solid cloud along a
  // straight line and draws that line; a cut erodes it, and what is left is the
  // material's own torn rim. Laid down without this, the far field is a set of
  // parallelograms hanging in the sky, which is exactly what the first panorama
  // at twelve degrees showed at eleven bearings out of twelve.
  const radial = tile.kind === 'library';

  // What the fade is about to be asked to remove.
  //
  // Border coverage of nothing is easy to reach and says almost nothing: fade
  // anything steeply enough and it ends at zero. What decides whether an edge
  // is a line is how much mass was standing in the band when the fade arrived,
  // so that is what is recorded — per side, as the coverage the band's own
  // ninety ninth texel carries.
  const band = [Math.round(width * EDGE_FADE), Math.round(height * EDGE_FADE)];
  const sides = [[], [], [], []];
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const v = a[j * width + i];
      if (i < band[0]) sides[0].push(v);
      if (j < band[1]) sides[1].push(v);
      if (i >= width - band[0]) sides[2].push(v);
      if (j >= height - band[1]) sides[3].push(v);
    }
  }
  tile.fadeBandCover = sides.map((list) => {
    if (!list.length) return 0;
    list.sort((p, q) => p - q);
    return list[Math.floor(list.length * 0.99)];
  });

  const { c, right, up } = tileBasis(tile.azimuth, tile.elevation);
  const dir = [0, 0, 0];
  for (let j = 0; j < height; j++) {
    const t = Math.min((j + 0.5) / height, 1 - (j + 0.5) / height) * 2;
    const fadeV = smoothstep(0, EDGE_FADE, t);
    const dv = 2 * (j + 0.5) / height - 1;
    for (let i = 0; i < width; i++) {
      const s = Math.min((i + 0.5) / width, 1 - (i + 0.5) / width) * 2;
      const du = 2 * (i + 0.5) / width - 1;
      const fade = radial
        ? smoothstep(1.0, 0.70, Math.hypot(du, dv)) * fadeV * smoothstep(0, EDGE_FADE, s)
        : fadeV * smoothstep(0, EDGE_FADE, s);
      // How much material stands here at all, and this window's share of it.
      //
      // The first is the fades of every window that reaches this direction,
      // capped at one: where a single window is fading out there is nothing to
      // hand the material to, so it goes with the fade, which is the guillotine
      // rule and it does not change. The second is this window's part of what
      // is left, and the two together are what makes a lone tile behave exactly
      // as it did and an overlap composite back to the material once.
      let standing = fade;
      let share = 1;
      if (masses.length) {
        for (let k = 0; k < 3; k++) {
          dir[k] = c[k] + du * tile.halfU * right[k] + dv * tile.halfV * up[k];
        }
        let total = 0;
        for (const other of masses) total += windowWeight(other, dir);
        standing = Math.min(1, total);
        share = total > 1e-6 ? fade / total : 0;
      }
      const o = j * width + i;
      // The tail is cut, and only where the fade is cutting.
      //
      // What a fade leaves behind is a skirt of coverage a few per cent deep,
      // and a few per cent of coverage still carries colour: a haze in the shape
      // of the window with an edge where the fade finally reaches nothing. So
      // the tail goes. But it may only go where the fade is: taken across the
      // whole tile — which is what this did first — every partly covered texel
      // loses a tenth of its coverage and a tenth of its colour with it, and the
      // separation stops being exact. Measured at the reference pose that cost
      // the frame twenty three levels at the median of the hero bank and left
      // the opaque cores untouched, which is precisely the signature: solid
      // cloud survives a proportional cut and everything thin does not.
      // Across a library piece the cut is everywhere, because the matte is
      // everywhere; on a mass it is only where the fade is, or every partly
      // covered texel of the photograph loses a tenth of itself.
      const tail = radial ? TAIL_CUT : TAIL_CUT * (1 - fade);
      // A library piece is matted, not shared: it stands where nothing else
      // stands, and its share is its matte. A mass takes the part of the
      // material its window is owed, which is the exponent above.
      // Clamped before the power: a carried coverage can land a hair over one,
      // and a fractional power of a negative number is not a number at all.
      const have = Math.max(0, Math.min(1, a[o]));
      const held = radial ? have * fade
        : 1 - Math.max(OPAQUE_FLOOR, 1 - have * standing) ** share;
      const cut = Math.max(0, (held - tail) / (1 - tail));
      // The colour is premultiplied by the coverage it came with, so it is
      // renormalised whenever that coverage changes. In the body of the tile
      // nothing changes and this is exactly one.
      const scale = a[o] > 1e-4 ? cut / a[o] : 0;
      a[o] = cut;
      for (let k = 0; k < 3; k++) rgb[o * 3 + k] *= scale;

      // Cloud is white with a blue shadow, and nothing else — but only where
      // nobody photographed it.
      //
      // The stored colour is the difference between the reference and the sky
      // behind it, and where the coverage is a third that difference is two
      // nearly equal numbers subtracted: a completed texel's hue is then
      // arithmetic rather than weather, and left alone it arrives as brown where
      // enough thin edges land on one another, or as a magenta speck where a
      // per channel bound lets red to the top of its range and green to the
      // bottom of its at once. A measured texel is not touched at all: its hue
      // may be strange in isolation and it is still exact, because composited
      // back over the sky it was separated from it returns the reference's own
      // pixel, whatever the separation believed about the coverage.
      if (known[o]) continue;
      const luma = 0.2126 * rgb[o * 3] + 0.7152 * rgb[o * 3 + 1] + 0.0722 * rgb[o * 3 + 2];
      if (luma <= 1e-6) {
        for (let k = 0; k < 3; k++) rgb[o * 3 + k] = 0;
        continue;
      }
      for (let k = 0; k < 3; k++) {
        rgb[o * 3 + k] = luma * Math.min(CLOUD_CHROMA[1],
          Math.max(CLOUD_CHROMA[0], rgb[o * 3 + k] / luma));
      }
      rgb[o * 3 + 1] = Math.min(
        Math.max(rgb[o * 3 + 1], Math.min(rgb[o * 3], rgb[o * 3 + 2])),
        Math.max(rgb[o * 3], rgb[o * 3 + 2]),
      );
      // The hue is the one thing here that moves a colour without moving the
      // coverage it is premultiplied by, so it is the one thing that can take a
      // texel over the ceiling on its own: a channel spread to the top of its
      // chroma at fixed luma asks for a brighter cloud than it was given. It
      // never showed while the coverage was the separation's own, because the
      // colour then sat well under the bound; with the coverage cut to the least
      // that carries the departure the material lives AT the bound, and this
      // clamp walked it five per cent past — measured, and caught by the ceiling
      // gate. Held here, where it is broken.
      for (let k = 0; k < 3; k++) {
        rgb[o * 3 + k] = Math.min(rgb[o * 3 + k], a[o] * ceiling[k]);
      }
    }
  }

  let border = 0;
  for (let i = 0; i < width; i++) border = Math.max(border, a[i], a[(height - 1) * width + i]);
  for (let j = 0; j < height; j++) {
    border = Math.max(border, a[j * width], a[j * width + width - 1]);
  }
  const inset = [width, height, width, height];
  const LIVE = 0.5 / 255;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      if (a[j * width + i] <= LIVE) continue;
      inset[0] = Math.min(inset[0], i);
      inset[1] = Math.min(inset[1], j);
      inset[2] = Math.min(inset[2], width - 1 - i);
      inset[3] = Math.min(inset[3], height - 1 - j);
    }
  }
  tile.borderAlpha = border;
  tile.insetPercent = [
    100 * inset[0] / width, 100 * inset[1] / height,
    100 * inset[2] / width, 100 * inset[3] / height,
  ];
}

/**
 * What the sun was doing where a tile was cut.
 *
 * The one number a piece has to carry with it when it moves. Everything else
 * about its light is in its own coverage.
 */
function recordSun(tile, sun) {
  tile.sunSource = sunInLocalFrame(tile.elevation, tile.azimuth, sun);
}


// ------------------------------------------------------------- the silhouette

// How much sky one cell of a silhouette stands for, in degrees.
//
// The grain of the cover, and the only number in it. Coarser and the cover is a
// box again; finer and it is a lace of quads whose edges cost more to set up
// than the sky inside them costs to blend.
// This number is also the field's whole fill budget, and it is NOT a
// conservative choice. It has been measured downwards and it does not go.
//
// The arrival is where the weather covers the most frame it ever covers, and
// there the field costs a millisecond and a quarter of a twelve and a half
// millisecond budget. A finer cover is the obvious place to look for that: over
// the six whole tiles a one degree cell draws a eleventh less solid angle and a
// four fifths cell an ninth less, for two hundred and seventeen quads becoming
// four hundred and thirty nine, which on this machine is nothing.
//
// It is not available, and the reason is the one this whole tool is about. A
// tighter cover clips the fade band before it has reached nothing, and where the
// material under that band is a smooth continuation past the edge of the
// photograph the clip is a guillotine. Measured: at one degree the invariant
// below reports hero-east putting 83 to 85 levels down a column from three of
// the four lateral standing places, against the 70 a line drawn by invention is
// allowed. At the value kept here the same column reports 62.5 — under the bar,
// and not by much.
//
// So the cover is at its limit, the limit is a straight edge and not a cost, and
// the fill at the arrival has to be found somewhere that is not the silhouette.
const CELL_DEG = 1.6;

// And how many cells a tile may be divided into, along either axis, so that a
// tile cut at a strange aspect cannot ask for thousands. Nothing in this bake
// comes near it; it is a fence, not a resolution.
const CELL_MAX = 24;

// The coverage a cell has to carry before it is worth a quad.
//
// Not zero, and the reason is arithmetic rather than taste: a texel at one part
// in two hundred and fifty five moves the frame by a fiftieth of the difference
// between a cloud and the sky behind it, which is under one level of colour and
// under the dither the composite pass already adds. Cells with nothing but that
// in them are dropped, and what is dropped is measured below.
const CELL_LIVE = 3 / 255;

/**
 * The shape a sprite is drawn on: its window, cut back to the cloud in it.
 *
 * A rectangle round a cumulus is mostly empty, and every empty texel of it is a
 * fragment the frame blends and throws away. A convex hull is barely better,
 * because a bank is not convex — measured on the hero, an octagon fitted to its
 * coverage still covers eighty four per cent of the rectangle it was cut from,
 * against a coverage of eleven, and the frame pays for the difference.
 *
 * So the cover is not one polygon. The window is divided into cells a couple of
 * degrees across, the cells with no coverage in them are dropped, and what is
 * left is merged along each row into runs. Every run is a quad; they do not
 * overlap; between them they contain every live texel, because a cell is kept if
 * anything at all in it is live.
 */
function fitSilhouette(tile) {
  const { a, width, height } = tile;
  const spanU = 2 * Math.atan(tile.halfU) / DEG;
  const spanV = 2 * Math.atan(tile.halfV) / DEG;
  const cols = Math.max(2, Math.min(CELL_MAX, Math.round(spanU / CELL_DEG)));
  const rows = Math.max(2, Math.min(CELL_MAX, Math.round(spanV / CELL_DEG)));
  const peak = new Float32Array(cols * rows);
  let held = 0;
  let dropped = 0;
  for (let j = 0; j < height; j++) {
    const r = Math.min(rows - 1, Math.floor(j / height * rows));
    for (let i = 0; i < width; i++) {
      const o = r * cols + Math.min(cols - 1, Math.floor(i / width * cols));
      peak[o] = Math.max(peak[o], a[j * width + i]);
    }
  }
  const live = new Uint8Array(cols * rows);
  for (let c = 0; c < cols * rows; c++) {
    if (peak[c] > CELL_LIVE) { live[c] = 1; held++; } else if (peak[c] > 0) dropped++;
  }
  tile.cellsDropped = dropped;
  void held;

  const parts = [];
  for (let r = 0; r < rows; r++) {
    let start = -1;
    for (let c = 0; c <= cols; c++) {
      const on = c < cols && live[r * cols + c] === 1;
      if (on && start < 0) start = c;
      if (!on && start >= 0) {
        parts.push([
          start / cols * 2 - 1, 1 - (r + 1) / rows * 2,
          c / cols * 2 - 1, 1 - r / rows * 2,
        ]);
        start = -1;
      }
    }
  }
  if (!parts.length) parts.push([-1, -1, 1, 1]);
  const area = parts.reduce((t, p) => t + (p[2] - p[0]) * (p[3] - p[1]), 0);
  // The mask travels with the runs: the equirect below has to lay down exactly
  // the cells the frame draws, and rebuilding them from the runs would be a
  // second answer to a question that already has one.
  return {
    parts, areaRatio: area / 4, cells: `${cols}x${rows}`, live, cols, rows,
  };
}

/** The texels a tile's cover actually draws, one per texel of the tile. */
function drawnMask(tile) {
  const {
    width, height, silhouette: {
      live, cols, rows,
    },
  } = tile;
  const drawn = new Uint8Array(width * height);
  for (let j = 0; j < height; j++) {
    const r = Math.min(rows - 1, Math.floor(j / height * rows));
    for (let i = 0; i < width; i++) {
      const c = Math.min(cols - 1, Math.floor(i / width * cols));
      drawn[j * width + i] = live[r * cols + c];
    }
  }
  return drawn;
}

/**
 * Brings the coverage to nothing at every edge the COVER cuts.
 *
 * The window's own border is not the only straight line a sprite has in it. The
 * cover is a set of cells a degree and a half across, and the boundary of that
 * set is a staircase; a cell is kept when anything in it is live, so the
 * coverage at that staircase is usually a whisper — but usually is not an
 * invariant, and the whole lesson of this bake is that a cut through material
 * draws a line whatever the material was doing on average.
 *
 * So the field dies inside the cover rather than at it, with the tail cut in the
 * same breath, and the cover is fitted again afterwards because a cell the fade
 * emptied is a cell the frame should not be drawing at all. Two or three rounds
 * settle it; the loop stops when nothing more is dropped.
 */
function closeSilhouette(tile) {
  const {
    width, height, a, rgb,
  } = tile;
  for (let round = 0; round < 4; round++) {
    const { cols, rows } = tile.silhouette;
    const drawn = drawnMask(tile);
    const outside = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) outside[i] = drawn[i] ? 0 : 1;
    const { dist } = distanceTo(outside, width, height);
    const band = Math.max(2, CELL_FADE * Math.min(width / cols, height / rows));
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const o = j * width + i;
        if (!drawn[o]) { a[o] = 0; rgb[o * 3] = 0; rgb[o * 3 + 1] = 0; rgb[o * 3 + 2] = 0; continue; }
        // The tile's own rim is a cut too, and there is no texel outside it to
        // measure the distance from, so it is measured against the edge itself.
        const reach = Math.min(dist[o], i + 1, j + 1, width - i, height - j);
        const fade = smoothstep(0, band, reach - 0.5);
        if (fade >= 1) continue;
        const tail = TAIL_CUT * (1 - fade);
        const kept = Math.max(0, (a[o] * fade - tail) / (1 - tail));
        const scale = a[o] > 1e-4 ? kept / a[o] : 0;
        a[o] = kept;
        for (let k = 0; k < 3; k++) rgb[o * 3 + k] *= scale;
      }
    }
    const before = tile.silhouette.parts.length;
    const liveBefore = tile.silhouette.live.reduce((t, v) => t + v, 0);
    tile.silhouette = fitSilhouette(tile);
    const liveAfter = tile.silhouette.live.reduce((t, v) => t + v, 0);
    if (liveAfter === liveBefore && tile.silhouette.parts.length === before) break;
  }
}

/**
 * Holds every texel to a colour a cloud has, at the coverage that SHIPS.
 *
 * The solve in separate() makes the measured material a layer, and everything
 * between here and there keeps it one: the carry and the continuation average
 * four channels together, which is a weighted mean of colours already in range,
 * and every
 * close scales the colour by the same factor as the coverage. What none of them
 * can do is know what the atlas will round the coverage to.
 *
 * Eight bits of coverage is a step of one part in two hundred and fifty five,
 * and a texel whose coverage rounds DOWN carries a colour solved for the
 * coverage it had: divided by what it ends up with, the colour it is asking for
 * is larger than the one it was given. Measured on this atlas, that alone took
 * the brightest colour any texel asks of a cloud half again over the ceiling.
 * At a fringe, where the coverage is a step or two, half again is the whole of
 * what the eye sees.
 *
 * So the last word on the material is said against the number that ships, and
 * it is said here rather than at the atlas write because the level scale, the
 * equirect the water reflects and every invariant below all have to be reading
 * the same picture the frame will.
 *
 * The hold is the LAYER'S OWN last word, not a repair standing on its own, so
 * the development handle takes it away with the rest of the layer. Leaving it in
 * on a run whose material was deliberately left carrying its sky would have
 * every reading below judging a picture this function had already brought back
 * inside the ceiling — measured: the two sky reading came out at 2.0 levels of
 * the 3 it allows, on material whose worst texel was asking for a cloud two
 * hundred and fifty times the brightest one in the photograph. The quantisation
 * stays either way, because eight bits is what the atlas has whatever this bake
 * believes.
 */
function holdToCoverage(tiles, ceiling, { clamp = true } = {}) {
  let held = 0;
  let total = 0;
  let arrived = 0;
  let arrivedAt = null;
  let shipped = 0;
  for (const tile of tiles) {
    for (let i = 0; i < tile.width * tile.height; i++) {
      const had = Math.max(0, Math.min(1, tile.a[i]));
      const stored = Math.round(had * 255) / 255;
      tile.a[i] = stored;
      total++;
      // WHAT ARRIVED, read against the coverage the material was built with:
      // this is the invariant, and it has to be read before anything below can
      // make it true. A texel over the ceiling here is a texel whose colour did
      // not die with its coverage somewhere upstream.
      if (had > 0) {
        for (let k = 0; k < 3; k++) {
          const own = Math.max(0, tile.rgb[i * 3 + k]) / had;
          if (own > arrived) {
            arrived = own;
            arrivedAt = `${tile.id} texel ${i % tile.width},${(i / tile.width) | 0} `
              + `of ${tile.width}x${tile.height}, coverage ${had.toFixed(4)}`;
          }
        }
      }
      if (stored <= 0) {
        for (let k = 0; k < 3; k++) tile.rgb[i * 3 + k] = 0;
        continue;
      }
      let touched = false;
      for (let k = 0; k < 3; k++) {
        const own = Math.max(0, tile.rgb[i * 3 + k]) / stored;
        shipped = Math.max(shipped, Math.min(own, ceiling[k]));
        if (own <= ceiling[k] || !clamp) {
          tile.rgb[i * 3 + k] = Math.max(0, tile.rgb[i * 3 + k]);
          continue;
        }
        tile.rgb[i * 3 + k] = stored * ceiling[k];
        touched = true;
      }
      if (touched) held++;
    }
  }
  return {
    arrived, arrivedAt, held, total, shipped,
  };
}

/**
 * The "nothing this field draws ends in a straight line" invariant.
 *
 * Every edge a sprite has that is not a cloud's own edge — the border of its
 * window, and the staircase of its cover — is measured for the coverage standing
 * on it. Anything above the figure a cell is dropped at is a ruled line waiting
 * for something to uncover it, and the bake fails rather than shipping it.
 *
 * @returns {string[]} one complaint per cut, empty when every edge is the
 *   material's own
 */
function checkStraightCuts(tiles) {
  const complaints = [];
  for (const tile of tiles) {
    const {
      width, height, a,
    } = tile;
    const drawn = drawnMask(tile);
    let worst = 0;
    let at = null;
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const o = j * width + i;
        if (!drawn[o]) continue;
        const edge = i === 0 || j === 0 || i === width - 1 || j === height - 1
          || !drawn[o - 1] || !drawn[o + 1] || !drawn[o - width] || !drawn[o + width];
        if (!edge || a[o] <= worst) continue;
        worst = a[o];
        at = [i, j];
      }
    }
    tile.edgeAlpha = worst;
    if (worst > CELL_LIVE) {
      complaints.push(`${tile.id} carries ${worst.toFixed(3)} of coverage on the edge of `
        + `what it draws, at texel ${at[0]},${at[1]} of ${width}x${height} `
        + `(a cell is dropped below ${CELL_LIVE.toFixed(4)}): that edge is a ruled line`);
    }
  }
  return complaints;
}

// ------------------------------------------------------------- the two skies

// How far apart a second sky is put, to ask the material whether it minds.
//
// A fifth darker, everywhere, which is a long way further than an hour of a
// day and cheap to state: a preset is a point in a small space of numbers and
// this is one scaling of the exposure in it. The reading below has to come out
// the same on both, and what makes it come out the same is not a tolerance —
// it is that the stored quantity has no sky in it at all.
const OTHER_SKY = 0.8;

// What the frame draws where its own material says there is nothing, in levels
// of the eight bit frame it is delivered in — REPORTED against this, and not
// judged against it, which is a decision with a measurement behind it.
//
// Three levels is the right figure for what the eye finds: the composite pass
// dithers by one step, the atlas by one more, and the gate that failed this sky
// measured its curtains as a step of ten and a half levels over four pixels
// against a floor of minus two point eight. It is not a figure a WORST TEXEL
// can be held to, and the reason is the atlas rather than the weather. Coverage
// is stored in eight bits, so the smallest a texel can carry and still exist is
// one part in two hundred and fifty five; carrying a cloud at the ceiling, that
// one step draws up to twenty three levels over the darkest sky this dome
// makes. There is no material that fixes it and no cut that hides it — a
// coverage below one step is not a coverage, it is nothing, and the step above
// nothing is worth what it is worth.
//
// So the mean over the band is what says whether there is a WASH, which is what
// a curtain is, and the worst is reported beside the bound one stored step
// buys, so that the two can be told apart.
const SKY_TOLL = 3;

// The coverage below which the field is CLAIMING there is nothing there: the
// figure a cell of the cover is dropped at, so this reads the bake against its
// own definition of empty rather than against one invented for the occasion.
const NOTHING_THERE = CELL_LIVE;

/**
 * The "these clouds do not care what sky they are drawn on" invariant.
 *
 * Two readings, and the first is the one that would have caught the fault.
 *
 * WHAT A TEXEL ASKS OF A CLOUD. The frame composites premultiplied, so a texel
 * is a coverage and a coverage times a colour, and the colour it is asking for
 * is the second divided by the first. That colour has a ceiling — the brightest
 * this photograph's own cloud is — and a texel over it is not weather but
 * arithmetic: the atlas that failed the thirteenth gate asked, at a coverage of
 * one part in two hundred and fifty five, for a cloud a hundred and thirty
 * eight times as bright as the sky, which is eight times anything in the
 * picture. That is the curtain, in one number, before any sky is chosen.
 *
 * WHAT IT DRAWS ON TWO SKIES. Every sprite the frame stands up is composited at
 * the bearing it stands at, over the dome the frame draws and over the same
 * dome a fifth darker, and what is read is the departure from the sky it is
 * standing on. Where the field's own cover says there is nothing, that
 * departure has to be under the dither on BOTH — and it is, when the stored
 * quantity is a coverage times a colour, because both terms of
 * cover*(colour - sky) go to nothing with the cover. Where there is cloud the
 * departure is the cloud, and it is reported rather than judged: a bank is
 * meant to change the sky it hangs in.
 *
 * The dome is read from the preset that ships, which is the one the frame
 * actually draws. That is a dependency — the sky bake before the cloud bake —
 * and it is only a dependency of the CHECK: nothing the dome says reaches the
 * material any more, which is the property being checked.
 */
function checkTwoSkies(field, day, ceiling, sun) {
  const complaints = [];
  const bands = [[1e-9, NOTHING_THERE], [NOTHING_THERE, 0.05], [0.05, 0.15],
    [0.15, 0.35], [0.35, 0.7], [0.7, 1.001]];
  const stat = bands.map(() => ({ n: 0, sum: 0, worst: 0 }));
  const sky = [0, 0, 0];
  const dim = [0, 0, 0];
  const over = [0, 0, 0];
  const colour = [0, 0, 0];
  let asked = 0;
  let askedAt = null;
  let worstNothing = 0;
  let worstNothingAt = null;
  let oneStep = 0;
  for (const sprite of field) {
    const { tile } = sprite;
    if (!tile.silhouette) continue;
    const { c, right, up } = tileBasis(sprite.azimuth, sprite.elevation);
    const roll = (sprite.roll || 0) * DEG;
    const cosR = Math.cos(roll);
    const sinR = Math.sin(roll);
    const target = sprite.relit
      ? sunInLocalFrame(sprite.elevation, sprite.azimuth, sun) : tile.sunSource;
    const perDegree = 1 / (2 * tile.degPerTexel * (sprite.scale || 1));
    const drawn = drawnMask(tile);
    for (let j = 0; j < tile.height; j++) {
      for (let i = 0; i < tile.width; i++) {
        const o = j * tile.width + i;
        if (!drawn[o]) continue;
        const cover = tile.a[o];
        if (cover <= 0) continue;
        for (let k = 0; k < 3; k++) colour[k] = tile.rgb[o * 3 + k];
        // A piece laid where it was not cut is relit, and the frame does that
        // multiplication on any sky alike — so it belongs in what a texel is
        // asking for, and not in whether the sky matters.
        if (sprite.relit && i > 0 && j > 0 && i < tile.width - 1 && j < tile.height - 1) {
          const gx = (tile.a[o + 1] - tile.a[o - 1]) * perDegree;
          const gy = (tile.a[o - tile.width] - tile.a[o + tile.width]) * perDegree;
          const tx = gx * sprite.flip;
          const ratio = shadeAt(tx * cosR - gy * sinR, tx * sinR + gy * cosR, cover, target)
            / Math.max(0.05, shadeAt(gx, gy, cover, tile.sunSource));
          for (let k = 0; k < 3; k++) colour[k] *= ratio;
        }
        for (let k = 0; k < 3; k++) {
          const own = colour[k] / cover;
          if (own > asked) {
            asked = own;
            askedAt = `${tile.id} at az ${sprite.azimuth.toFixed(1)}, texel ${i},${j} of `
              + `${tile.width}x${tile.height}, coverage ${cover.toFixed(4)}`;
          }
        }
        // Where this texel stands in the sky, roll and mirror and all.
        const su = (2 * (i + 0.5) / tile.width - 1) * sprite.flip;
        const tv = 1 - 2 * (j + 0.5) / tile.height;
        const u = (su * cosR - tv * sinR) * sprite.halfU;
        const v = (su * sinR + tv * cosR) * sprite.halfV;
        const d = [c[0] + u * right[0] + v * up[0], c[1] + u * right[1] + v * up[1],
          c[2] + u * right[2] + v * up[2]];
        const len = Math.hypot(d[0], d[1], d[2]);
        const elevation = Math.asin(Math.max(-1, Math.min(1, d[1] / len))) / DEG;
        const azimuth = Math.atan2(d[0] / len, -d[2] / len) / DEG;
        domeAt(day, elevation, azimuth, sky);
        // What one stored step of coverage is worth here, carrying a cloud at
        // the ceiling: the floor under every worst case below, and a property
        // of the atlas's own eight bits rather than of anything in this bake.
        for (let k = 0; k < 3; k++) {
          over[k] = ceiling[k] / 255 + sky[k] * (1 - 1 / 255);
        }
        oneStep = Math.max(oneStep, Math.abs(displayLevel(over) - displayLevel(sky)));
        let departure = 0;
        for (const scale of [1, OTHER_SKY]) {
          for (let k = 0; k < 3; k++) {
            dim[k] = sky[k] * scale;
            over[k] = colour[k] + dim[k] * (1 - cover);
          }
          departure = Math.max(departure, Math.abs(displayLevel(over) - displayLevel(dim)));
        }
        const band = bands.findIndex(([lo, hi]) => cover >= lo && cover < hi);
        if (band >= 0) {
          stat[band].n++;
          stat[band].sum += departure;
          stat[band].worst = Math.max(stat[band].worst, departure);
        }
        if (cover < NOTHING_THERE && departure > worstNothing) {
          worstNothing = departure;
          worstNothingAt = `${tile.id} at az ${sprite.azimuth.toFixed(1)}, texel ${i},${j}, `
            + `coverage ${cover.toFixed(4)}`;
        }
      }
    }
  }
  const report = ['  coverage        texels   mean departure from the sky it stands on   worst'];
  bands.forEach(([lo, hi], k) => {
    const s = stat[k];
    if (!s.n) return;
    report.push(`  ${lo.toFixed(4)}-${hi.toFixed(3)} ${String(s.n).padStart(9)}   `
      + `${(s.sum / s.n).toFixed(1).padStart(24)} ${s.worst.toFixed(1).padStart(11)}`);
  });
  const nothing = stat[0];
  const meanNothing = nothing.n ? nothing.sum / nothing.n : 0;
  report.push(`  one stored step of coverage carrying a cloud at the ceiling is worth up to `
    + `${oneStep.toFixed(1)} levels over the skies these pieces stand on, which is the floor `
    + 'under every worst case above');
  // The wash, which is what a curtain is: a mean over the whole band where the
  // field claims nothing, rather than a texel of it.
  if (meanNothing > SKY_TOLL) {
    complaints.push(`where the field's own cover says there is nothing (under `
      + `${NOTHING_THERE.toFixed(4)}) it draws ${meanNothing.toFixed(1)} levels on average `
      + `across ${nothing.n} texels, against ${SKY_TOLL} allowed: that is a wash`);
  }
  // ...and the worst texel of that band, against the only bound the atlas
  // leaves room for. Eight bits of coverage cannot express less than one step,
  // and one step carrying a cloud at the ceiling is worth what it is worth over
  // the darkest sky these pieces stand on; below that there is no material to
  // be had. Anything ABOVE it is a texel drawing more than its own coverage
  // could account for, which is the fault this invariant exists to name.
  const floor = Math.max(SKY_TOLL, oneStep);
  if (worstNothing > floor) {
    complaints.push(`the worst texel where the cover says nothing draws `
      + `${worstNothing.toFixed(1)} levels, past the ${floor.toFixed(1)} that one stored step `
      + `of coverage at the ceiling can account for (${worstNothingAt})`);
  }
  // And the reading that would have caught the thirteenth gate's atlas before a
  // sky was ever chosen: what a texel is asking the frame to draw a cloud AT,
  // read on the field as it stands, relighting and all. Over the brightest
  // cloud this photograph has, it is not a cloud.
  const top = Math.max(...ceiling);
  if (asked > top * 1.001) {
    complaints.push(`a texel asks for a cloud at ${asked.toFixed(2)}, against the `
      + `${top.toFixed(2)} the brightest cloud in this photograph carries (${askedAt}): its `
      + 'colour did not die with its coverage');
  }
  return {
    complaints, report, asked, askedAt, worstNothing, worstNothingAt, meanNothing, oneStep,
  };
}

// ------------------------------------------------- the walk to either side
//
// The straight cut invariant above reads every tile on its own, and a tile that
// passes it can still put a ruled line in the sky, because a line in the sky is
// a property of the COMPOSITION and not of any one sprite in it. The eighth gate
// found four of them from the standing places six and twelve metres either side
// of the reference pose: pale vertical slabs one cell wide, at the borders of
// the masses' windows, hidden at the reference pose by the blocks that stand in
// front of them and uncovered by two steps sideways.
//
// So the composition is drawn here, from those bearings, and read for them.

// The bearings the lateral walk looks along, with the height it looks at.
//
// Stated as bearings rather than as standing places, and that is exact rather
// than a simplification: this weather is nine hundred metres out, so twelve
// metres of walking moves it by four thousandths of a degree. What a step
// sideways actually changes is which way the walker is facing and which piece of
// sky the blocks are no longer covering — and the blocks are not in this bake at
// all, which is the point of reading it here.
// And WHERE THE WALKER IS STANDING, which the eighth and ninth gates read from
// and this bake did not.
//
// Stating them as bearings alone was defended on the grounds that the weather is
// nine hundred metres out, so twelve metres of walking moves it by four
// thousandths of a degree — and that is true of the WEATHER and false of the
// FRAME. The dome is pinned to the eye and does not move at all; the field is
// pinned to the reference pose and does. Twelve metres to the west slides the
// whole composition across the dome behind it by three quarters of a degree,
// which is fifteen pixels of this framing, and what was hidden inside a block's
// silhouette at the reference pose is fifteen pixels out of it there. Every one
// of the reviewer's readings was taken standing in one of these places, so this
// is where the bake reads too.
const LATERAL_BEARINGS = [
  { id: 'L2', yaw: 12, pitch: 8, east: -12 },
  { id: 'L1', yaw: 6, pitch: 8, east: -6 },
  { id: 'R1', yaw: -6, pitch: 8, east: 6 },
  { id: 'R2', yaw: -12, pitch: 8, east: 12 },
];

// How far out the frame hangs this composition, in metres. The runtime's own
// number (DISTANCE in src/world/clouds.js), written into every placement below
// and used here, because a reading taken from a standing place other than the
// anchor depends on it and a second copy of it would be a second chance to
// disagree.
const SPRITE_DISTANCE = 900;

// ------------------------------------------------------------------ the bar
//
// What the eighth gate found and the run detector that replaced it did not.
//
// The old reading asked: how many rows in a row does one column of the frame
// hold a step in coverage, with clear sky on one side of it. It reported 76 of
// 103 allowed for the very bearing whose crop shows a pale slab three hundred
// rows tall, and it was wrong twice over. It required OPEN SKY on the low side,
// so a bar standing over other weather — which is what a bar at the edge of a
// block's silhouette always is — was not counted at all. And it required the
// rows to be CONSECUTIVE at a FIXED column, so a bar that leans by three pixels
// over three hundred rows, or that is interrupted by one row of turret, scored
// as three short runs and nothing else.
//
// The eye does neither. It integrates contrast along a line, and it judges that
// line against what the sky beside it is doing: a straight flank inside a
// cauliflower is invisible and the same flank standing in smooth air is a bar.
//
// So this is the reading, and it is three statements:
//
//   g   the horizontal step of the coverage across five pixels — the span the
//       gate measured its slabs across;
//   bg  what the columns four to forty pixels either side carry at the same row,
//       which is the texture of the weather there;
//   E   the largest sum of (g − bg − toll) down any column, over any run of rows.
//
// The last is a maximum subarray, so a row that fails costs the toll rather than
// the whole run, a long faint edge outscores a short strong one, and a column of
// ordinary cloud accumulates nothing because the toll eats it. It is stated in
// units of coverage times rows, which is what a bar is: how much edge, and how
// far down the sky it holds it.

// The span the step is read across, and the columns the background is read from.
const BAR_SPAN = 5;
const BAR_NEAR = 4;
const BAR_FAR = 40;

// What a row of any column is entitled to before it starts adding up.
//
// A cloud's own flanks put a step of a few thousandths on almost every column of
// the frame, and a hundred rows of that is not a bar. The toll is set where a
// cell of a silhouette is dropped, because it is the same question asked of one
// row instead of one cell: below this a row is not carrying an edge.
const BAR_TOLL = CELL_LIVE;

// How much more than the photograph's own straightest edge the field may carry.
//
// The threshold is read off the reference itself, in the same run, with the same
// reading, for the same reason it always was: real weather does draw near
// vertical flanks, and how much edge the longest one in this photograph holds is
// the only honest answer to "how straight is a sky allowed to be".
//
// The margin covers the two ways the field is not the photograph: it is
// resampled through a tile and back, and it is seen from bearings the photograph
// never had, where a flank the reference showed leaning is square on.
//
// A fifth, and it is a decision taken between two MEASURED anchors rather than a
// round number. Below it, the composition: its worst bearing carries 45.4 where
// the photograph's own longest flank carries 46.0, which is the whole claim this
// unit makes — that the field draws no more edge down a column than the picture
// it was cut from. Above it, the eighth gate's own slab, put back by hand on the
// bearing it was reported from, which comes in at 63.0. A fifth puts the line at
// 55 with a sixth of headroom below it and an eighth above, and the slab test
// below is what keeps that second figure honest: if a future composition ever
// raises the reference's own number far enough for the gate's slab to slip
// under, the bake fails on the slab rather than passing on the margin.
const BAR_MARGIN = 1.2;

/**
 * The most edge any one column of a picture carries, against its neighbours.
 *
 * @param {Float32Array} cover  coverage per pixel
 * @param {Uint8Array|null} blind  pixels that carry no reading at all — stone,
 *   land — where a run ends rather than stepping against nothing
 * @returns {{energy: number, x: number, y0: number, y1: number, step: number, at: number}}
 */
function barEnergy(cover, blind = null) {
  const half = (BAR_SPAN - 1) / 2;
  const g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = half; x < W - half; x++) {
      g[y * W + x] = Math.abs(cover[y * W + x + half] - cover[y * W + x - half]);
    }
  }
  // The background, from a running sum: everything within BAR_FAR, less
  // everything within BAR_NEAR, so a bar is never its own neighbourhood.
  const prefix = new Float64Array(W + 1);
  const bg = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) prefix[x + 1] = prefix[x] + g[y * W + x];
    for (let x = 0; x < W; x++) {
      const lo = Math.max(0, x - BAR_FAR);
      const hi = Math.min(W, x + BAR_FAR + 1);
      const inLo = Math.max(0, x - BAR_NEAR);
      const inHi = Math.min(W, x + BAR_NEAR + 1);
      const count = (hi - lo) - (inHi - inLo);
      bg[y * W + x] = count > 0
        ? ((prefix[hi] - prefix[lo]) - (prefix[inHi] - prefix[inLo])) / count : 0;
    }
  }
  let best = { energy: 0, x: 0, y0: 0, y1: 0, step: 0, at: 0 };
  for (let x = half; x < W - half; x++) {
    let acc = 0;
    let from = 0;
    let peak = 0;
    let peakAt = 0;
    for (let y = 0; y < H; y++) {
      const o = y * W + x;
      if (blind && (blind[o] || blind[o - half] || blind[o + half])) { acc = 0; peak = 0; continue; }
      const excess = g[o] - bg[o];
      const e = Math.max(0, excess) - BAR_TOLL;
      if (acc <= 0 && e > 0) { from = y; peak = 0; }
      acc = Math.max(0, acc + e);
      if (excess > peak) { peak = excess; peakAt = y; }
      if (acc > best.energy) {
        best = { energy: acc, x, y0: from, y1: y, step: peak, at: peakAt };
      }
    }
  }
  return best;
}

/**
 * The most edge the photograph's own weather carries down any one column.
 *
 * The same reading the composition is put through, on the coverage the reference
 * was separated into, so the two numbers are the same kind of number. A column
 * that runs into stone or land ends its run there: what is behind a block is not
 * an edge the photograph drew.
 */
function referenceBar(material) {
  const { cutAlpha, stone, ground } = material;
  const blind = new Uint8Array(W * H);
  const cover = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (stone[i] || ground[i]) { blind[i] = 1; continue; }
    cover[i] = cutAlpha[i];
  }
  return barEnergy(cover, blind);
}

/** The reference camera turned to a stated bearing and moved to a stated place. */
function makeLateralCamera({
  yaw, pitch, east = 0, north = 0,
}) {
  const tanV = Math.tan(POSE.fov * DEG / 2);
  const tanH = tanV * (W / H);
  const cy = Math.cos(yaw * DEG);
  const sy = Math.sin(yaw * DEG);
  const cp = Math.cos(pitch * DEG);
  const sp = Math.sin(pitch * DEG);
  // Where the eye stands, in metres from the place the field is anchored to,
  // which is the reference pose's own eye. The whole of what a step sideways
  // does to this composition is here; north is -Z, as everywhere else.
  const eye = [east, 0, -north];
  return {
    eye,
    /** Screen pixel to world direction. */
    ray(px, py) {
      const x = ((px + 0.5) / W * 2 - 1) * tanH;
      const y = (1 - (py + 0.5) / H * 2) * tanV;
      const y1 = y * cp + sp;
      const z1 = y * sp - cp;
      return [x * cy + z1 * sy, y1, -x * sy + z1 * cy];
    },
    /** World point, relative to the anchor, to screen pixel. */
    project(p) {
      const dx = p[0] - eye[0];
      const dy = p[1] - eye[1];
      const dz = p[2] - eye[2];
      const x = dx * cy - dz * sy;
      const z0 = dx * sy + dz * cy;
      const y = dy * cp + z0 * sp;
      const z = -dy * sp + z0 * cp;
      if (z >= -1e-6) return null;
      return [((x / -z) / tanH * 0.5 + 0.5) * W, (0.5 - (y / -z) / tanV * 0.5) * H];
    },
  };
}

/**
 * The field's coverage, drawn from one bearing exactly as the frame draws it.
 *
 * Far first and premultiplied, the same order and the same arithmetic the frame
 * uses, so what this reads is what a walker sees. Only the coverage is kept:
 * a ruled line in the sky is a line in how much cloud there is, and reading it
 * on coverage rather than on colour keeps the test from depending on how bright
 * the cloud behind it happened to be.
 *
 * @returns {{cover: Float32Array, colour: Float32Array, owner: Int32Array,
 *   made: Float32Array}} coverage and premultiplied colour per pixel, which
 *   sprite of the field last laid material on it, and whether that material is
 *   something the photograph never showed — which is the first thing to know
 *   about a straight edge, because the two sides of every hole in this picture
 *   are a block's silhouette and a block's silhouette is a rectangle.
 */
function drawField(field, camera) {
  const cover = new Float32Array(W * H);
  const paint = new Float32Array(W * H * 3);
  const owner = new Int32Array(W * H).fill(-1);
  const made = new Float32Array(W * H);
  const where = new Float32Array(W * H * 2);
  const colour = [0, 0, 0];
  const standing = camera.eye || [0, 0, 0];
  // Half the diagonal of the frame, as an angle, and what a sprite's own radius
  // has to be added to it to say "this one cannot be on the screen at all".
  const tanV = Math.tan(POSE.fov * DEG / 2);
  const halfDiagonal = Math.atan(Math.hypot(tanV * (W / H), tanV));
  for (let s = 0; s < field.length; s++) {
    const sprite = field[s];
    const { tile } = sprite;
    const { c, right, up } = tileBasis(sprite.azimuth, sprite.elevation);
    // Nothing behind the walker is drawn, and asking each of its texels one at a
    // time is most of the cost of this reading: a quad with a corner behind the
    // eye has no bounding box on the screen, so without this every piece of the
    // far side of the compass swept the whole frame.
    const axis = camera.ray((W - 1) / 2, (H - 1) / 2);
    const away = Math.acos(Math.min(1, Math.max(-1,
      axis[0] * c[0] + axis[1] * c[1] + axis[2] * c[2])));
    if (away > halfDiagonal + Math.atan(Math.hypot(sprite.halfU, sprite.halfV)) + 0.05) continue;
    const roll = (sprite.roll || 0) * DEG;
    const cosR = Math.cos(roll);
    const sinR = Math.sin(roll);
    // A piece that stands in the world is read from where the walker stands: it
    // hangs at a distance, and moving under it slides it across the dome
    // behind. A piece the DOME carries has no distance to have a parallax over
    // — it is a function of the direction and nothing else — so it is read from
    // the anchor whatever place this camera is at, which is exactly what the
    // frame does with it. Nor is it cut into cells: the frame reads the whole
    // rectangle, because a cell was dropped when nothing in it carried more
    // than what a dropped cell may carry, and there is no fill to save on a
    // fragment the dome was going to shade anyway.
    const eye = sprite.inDome ? [0, 0, 0] : standing;
    const { live, cols, rows } = tile.silhouette;

    // Where this sprite can land, from its own perimeter, so the sweep below is
    // over its own corner of the frame rather than over the whole of it.
    let x0 = W;
    let x1 = -1;
    let y0 = H;
    let y1 = -1;
    let behind = false;
    const dir = [0, 0, 0];
    for (let k = 0; k <= 32; k++) {
      const f = -1 + 2 * (k / 32);
      for (const [su, sv] of [[f, -1], [f, 1], [-1, f], [1, f]]) {
        const u = (su * cosR - sv * sinR) * sprite.halfU;
        const v = (su * sinR + sv * cosR) * sprite.halfV;
        for (let m = 0; m < 3; m++) {
          dir[m] = (c[m] + u * right[m] + v * up[m]) * SPRITE_DISTANCE;
        }
        const p = camera.project(dir);
        if (!p) { behind = true; continue; }
        x0 = Math.min(x0, Math.floor(p[0]) - 2); x1 = Math.max(x1, Math.ceil(p[0]) + 2);
        y0 = Math.min(y0, Math.floor(p[1]) - 2); y1 = Math.max(y1, Math.ceil(p[1]) + 2);
      }
    }
    // A quad with a corner behind the eye has no bounding box on the screen —
    // and neither has a picture the dome carries, whose corners were projected
    // just now from a standing place it does not have.
    if (behind || sprite.inDome) { x0 = 0; x1 = W - 1; y0 = 0; y1 = H - 1; }
    x0 = Math.max(0, x0); x1 = Math.min(W - 1, x1);
    y0 = Math.max(0, y0); y1 = Math.min(H - 1, y1);

    // The plane the quad lies in, as a plane in the world rather than as a
    // direction: from a standing place other than the anchor the two are not
    // the same question, and the whole point of this reading is that they are
    // not.
    const centre = [c[0] * SPRITE_DISTANCE, c[1] * SPRITE_DISTANCE, c[2] * SPRITE_DISTANCE];
    const reachU = SPRITE_DISTANCE * sprite.halfU;
    const reachV = SPRITE_DISTANCE * sprite.halfV;
    const ahead = (centre[0] - eye[0]) * c[0] + (centre[1] - eye[1]) * c[1]
      + (centre[2] - eye[2]) * c[2];
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const d = camera.ray(px, py);
        const w = d[0] * c[0] + d[1] * c[1] + d[2] * c[2];
        if (w <= 1e-3) continue;
        const along = ahead / w;
        if (along <= 0) continue;
        const hx = eye[0] + along * d[0] - centre[0];
        const hy = eye[1] + along * d[1] - centre[1];
        const hz = eye[2] + along * d[2] - centre[2];
        const U = (hx * right[0] + hy * right[1] + hz * right[2]) / reachU;
        const V = (hx * up[0] + hy * up[1] + hz * up[2]) / reachV;
        const su = (U * cosR + V * sinR) * sprite.flip;
        const t = -U * sinR + V * cosR;
        if (su < -1 || su > 1 || t < -1 || t > 1) continue;
        if (!sprite.inDome) {
          const col = Math.min(cols - 1, Math.floor((su + 1) / 2 * cols));
          const row = Math.min(rows - 1, Math.floor((1 - t) / 2 * rows));
          if (!live[row * cols + col]) continue;
        }
        const fi = (su + 1) / 2 * tile.width;
        const fj = (1 - t) / 2 * tile.height;
        const a = readTile(tile, fi, fj, colour);
        if (a <= 0) continue;
        const o = py * W + px;
        for (let k = 0; k < 3; k++) paint[o * 3 + k] = colour[k] + paint[o * 3 + k] * (1 - a);
        cover[o] = a + cover[o] * (1 - a);
        owner[o] = s;
        const ti = Math.min(tile.width - 1, Math.max(0, Math.round(fi - 0.5)));
        const tj = Math.min(tile.height - 1, Math.max(0, Math.round(fj - 0.5)));
        // 1 where a block took the picture away and it was filled back in,
        // 2 where the picture ran out and it was carried on: two different
        // inventions, made under two different rules, judged apart.
        made[o] = tile.invented[tj * tile.width + ti]
          ? (tile.beyond[tj * tile.width + ti] ? 2 : 1) : 0;
        // How far into its own window this material stood, so a complaint can
        // say whether the edge is the window's border, the cover's staircase or
        // something in the middle of the picture.
        where[o * 2] = Math.abs(su);
        where[o * 2 + 1] = Math.abs(t);
      }
    }
  }
  return {
    cover, colour: paint, owner, made, where,
  };
}

/**
 * The "nothing in this sky is drawn along a ruled line" invariant, from the
 * bearings the walk actually takes.
 *
 * A column of the frame is read for the step in coverage across five pixels; a
 * run of rows where that step stands above what a dropped cell carries, with
 * clear sky on the low side of it, is a straight edge in the weather. The sprite
 * that laid the material is named, because the cure is always in that sprite.
 *
 * @returns {{complaints: string[], report: string[]}}
 */
function checkLateralCuts(field, allowed) {
  const complaints = [];
  const report = [];
  for (const bearing of LATERAL_BEARINGS) {
    const { cover, owner, made, where } = drawField(field, makeLateralCamera(bearing));
    const worst = barEnergy(cover);
    const at = worst.at * W + worst.x;
    // Which side of the step the material is on, so the sprite named is the one
    // that laid it rather than the one it was laid against.
    const half = (BAR_SPAN - 1) / 2;
    const side = cover[at + half] > cover[at - half] ? half : -half;
    const sprite = owner[at + side] >= 0 ? field[owner[at + side]] : null;
    const named = sprite ? `${sprite.tile.id} at az ${sprite.azimuth.toFixed(1)}` : 'nothing';
    report.push(`  ${bearing.id} (yaw ${bearing.yaw}): worst column carries `
      + `${worst.energy.toFixed(1)} of ${allowed.toFixed(1)} allowed, over rows `
      + `${worst.y0}..${worst.y1} of column ${worst.x}, peak step ${worst.step.toFixed(3)}, `
      + `laid by ${named}${made[at + side] ? ', out of material the photograph never showed' : ''}`
      + `, at |u| ${where[(at + side) * 2].toFixed(3)} |v| ${where[(at + side) * 2 + 1].toFixed(3)} `
      + 'of its window');
    if (worst.energy > allowed) {
      complaints.push(`from ${bearing.id} (yaw ${bearing.yaw}) column ${worst.x} carries `
        + `${worst.energy.toFixed(1)} of vertical edge above what its neighbours carry, `
        + `down rows ${worst.y0}..${worst.y1}, peak step ${worst.step.toFixed(3)} of coverage `
        + `across ${BAR_SPAN} px, laid by ${named}: that is a bar, and ${allowed.toFixed(1)} `
        + "is what the photograph's own weather carries");
    }
  }
  return { complaints, report };
}

// ------------------------------------------- what the invention draws, in levels
//
// The reading above is about the composition and it is about COVERAGE, and both
// of those are why it passed the ninth gate while the reviewer was looking at
// panels of haze in the shape of a block. Coverage is not what an eye reads: a
// step of two hundredths of coverage is nothing in a bank and is a bar in clear
// sky, because what reaches the eye is the DIFFERENCE the field makes to the
// picture, which is that coverage times how far the cloud is from the sky behind
// it, through the tone curve. And the composition as a whole is not the thing at
// fault: the photograph's own weather draws long straight flanks and is entitled
// to.
//
// So this is the second reading, and it asks a different question of a different
// quantity. What the field ADDS to the frame, in levels of the delivered eight
// bit picture, from the places the walker actually stands — and only where the
// material standing there is material NOBODY PHOTOGRAPHED. The photograph may
// draw what it likes. The invention may not draw a line.

// What a row of a column is entitled to before it starts adding up, in levels.
//
// One, which is the dither the frame already carries: the sky is quantised at
// eight bits and noised by about a level to hide it, so nothing under a level is
// a thing anybody can see.
const INVENTED_TOLL = 1.0;

// And the STEP an invention may put across five pixels, in levels, which is what
// this reading actually fails on.
//
// The energy down a column is reported and not judged, because it rewards a
// wide soft swell as much as a knife and the cure for a knife is a wide soft
// swell. What cannot be argued with is the step.
//
// Two of them, because there are two kinds of material the photograph never
// showed here and they are made under different rules.
//
// A HOLE is enclosed: a block takes a piece out of the middle of the picture and
// the photograph stands all the way round it. Nothing is put in one any more —
// the photograph is carried a degree in and the rest is the dome — so what this
// number now measures is the ending of that carry, and it is a RATCHET on the
// material that ships rather than a licence. Between two measured anchors: this
// composition puts 23.7 levels across five pixels at its worst of eight
// readings, and the material the thirteenth gate bounced put 32.7 on the same
// reading. Twenty eight is a fifth above the first and below the second, which
// is the property wanted — a run that goes back to filling the holes cannot
// pass this.
//
// BEYOND the picture there is no enclosure: a bank that ran out of photograph is
// carried on, and the same low pass applied out there came back as a pale wash
// over ten degrees of sky with a rectangular hole in the middle of it, which is
// worse than what it cured. So that case keeps the older guards — the decay, the
// tail cut and the body test below — and this reading only holds the line where
// it stands: 52.6 at its worst of eight. Seventy is a ratchet on a number nobody
// has yet earned the right to lower, and it is written here rather than left
// unsaid.
//
// BOTH SKIES ARE JUDGED, and that is the correction this session owes the gate.
// The reading is a step in levels, so it depends on what the field is composited
// over, and the analytic dome is a long way darker than the sky the photograph
// has — twenty seven levels of luma over this frame's own sky — with a steeper
// tone curve down there, so the same material puts a bigger step on it. When the
// allowance was calibrated on the photograph's sky the dome reading was reported
// and not judged, and that is exactly where the curtain lived: 32.7 levels
// behind a block, over the allowance, on a reading nobody was allowed to fail.
// The allowances above are set on the worse of the two skies, so there is no
// reading left that the bake takes and does not act on.
const INVENTED_STEP = { hole: 28.0, beyond: 70.0 };

/**
 * The "nothing the photograph did not show draws a line" invariant.
 *
 * @returns {{complaints: string[], report: string[]}}
 */
function checkInventedEdges(field, material, { under, judged }) {
  const complaints = [];
  const report = [];
  const half = (BAR_SPAN - 1) / 2;
  const sky = [0, 0, 0];
  const lit = [0, 0, 0];
  const luma = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  for (const bearing of LATERAL_BEARINGS) {
    const camera = makeLateralCamera(bearing);
    const { cover, colour, owner, made } = drawField(field, camera);
    // What the field does to the picture, in levels: the frame with it, less the
    // frame without it, both through the tone curve the product puts them
    // through. Below the skyline there is ground in front of all of this and the
    // reading stops, exactly as the walker's frame does.
    const gain = new Float32Array(W * H);
    const blind = new Uint8Array(W * H);
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const o = py * W + px;
        const d = camera.ray(px, py);
        const len = Math.hypot(d[0], d[1], d[2]);
        if (d[1] / len < -0.02) { blind[o] = 1; continue; }
        under([d[0] / len, d[1] / len, d[2] / len], sky);
        for (let k = 0; k < 3; k++) lit[k] = colour[o * 3 + k] + sky[k] * (1 - cover[o]);
        gain[o] = 255 * (luma(agx(lit, 1).map(linearToSrgb))
          - luma(agx(sky, 1).map(linearToSrgb)));
      }
    }
    // The step across five pixels, against what the columns four to forty either
    // side carry at the same row: a straight flank inside a cauliflower is
    // invisible, the same flank standing in smooth air is a bar.
    const g = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = half; x < W - half; x++) {
        g[y * W + x] = Math.abs(gain[y * W + x + half] - gain[y * W + x - half]);
      }
    }
    const prefix = new Float64Array(W + 1);
    const bg = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) prefix[x + 1] = prefix[x] + g[y * W + x];
      for (let x = 0; x < W; x++) {
        const lo = Math.max(0, x - BAR_FAR);
        const hi = Math.min(W, x + BAR_FAR + 1);
        const inLo = Math.max(0, x - BAR_NEAR);
        const inHi = Math.min(W, x + BAR_NEAR + 1);
        const n = (hi - lo) - (inHi - inLo);
        bg[y * W + x] = n > 0
          ? ((prefix[hi] - prefix[lo]) - (prefix[inHi] - prefix[inLo])) / n : 0;
      }
    }
    const best = {
      hole: { energy: 0, x: 0, y0: 0, y1: 0, step: 0, at: 0 },
      beyond: { energy: 0, x: 0, y0: 0, y1: 0, step: 0, at: 0 },
    };
    for (const kind of ['hole', 'beyond']) {
    for (let x = half; x < W - half; x++) {
      let acc = 0;
      let from = 0;
      let peak = 0;
      let peakAt = 0;
      for (let y = 0; y < H; y++) {
        const o = y * W + x;
        // The higher side of the step is the side the material was laid on, and
        // only an INVENTED side is counted: the photograph's own flanks are the
        // photograph's business.
        const side = gain[o + half] > gain[o - half] ? half : -half;
        if (blind[o] || blind[o + half] || blind[o - half]
          || made[o + side] !== (kind === 'hole' ? 1 : 2)) {
          acc = 0; peak = 0; continue;
        }
        const excess = g[o] - bg[o];
        const e = Math.max(0, excess) - INVENTED_TOLL;
        if (acc <= 0 && e > 0) { from = y; peak = 0; }
        acc = Math.max(0, acc + e);
        if (excess > peak) { peak = excess; peakAt = y; }
        if (acc > best[kind].energy) {
          best[kind] = {
            energy: acc, x, y0: from, y1: y, step: peak, at: peakAt,
          };
        }
      }
    }
    }
    for (const kind of ['hole', 'beyond']) {
      const worst = best[kind];
      const at = worst.at * W + worst.x;
      const side = gain[at + half] > gain[at - half] ? half : -half;
      const sprite = owner[at + side] >= 0 ? field[owner[at + side]] : null;
      const named = sprite ? `${sprite.tile.id} at az ${sprite.azimuth.toFixed(1)}` : 'nothing';
      const where = kind === 'hole' ? 'behind a block' : 'past the frame';
      report.push(`  ${bearing.id} (yaw ${bearing.yaw}, ${bearing.east} m east) ${where}: `
        + `worst step ${worst.step.toFixed(1)} of ${INVENTED_STEP[kind]} levels `
        + `${judged ? 'allowed' : 'allowed on the reading this is calibrated on'}, down `
        + `column ${worst.x} rows ${worst.y0}..${worst.y1} (${worst.y1 - worst.y0 + 1} rows, `
        + `holding ${worst.energy.toFixed(0)} levels times rows), laid by ${named}`);
      if (judged && worst.step > INVENTED_STEP[kind]) {
        complaints.push(`from ${bearing.id} (yaw ${bearing.yaw}, standing ${bearing.east} m `
          + `east) column ${worst.x} puts ${worst.step.toFixed(1)} levels across ${BAR_SPAN} px `
          + `on material the photograph never showed ${where}, held down rows `
          + `${worst.y0}..${worst.y1}, laid by ${named}: that is an edge drawn by an `
          + `invention, and ${INVENTED_STEP[kind]} levels is all one is allowed`);
      }
    }
  }
  return { complaints, report };
}

// The slab the eighth gate reported, as it reported it: one cell of bearing
// wide, from seven degrees of elevation to twenty one, seen across five pixels.
//
// Put back by hand so the reading is shown finding the thing it was built for
// rather than asserted to. The depth is the shallowest of the four the gate
// measured, expressed as coverage rather than as luminance: the gate read plus
// twenty four levels of luma over a sky at about a hundred and fifty, against a
// cloud a hundred levels above that sky, which is a quarter of the difference.
const SLAB_DEG = 1.45;
const SLAB_ELEVATIONS = [7, 21];
const SLAB_COVER = 0.24;

/**
 * The gate's own slab, laid on a drawn frame, and what the reading makes of it.
 *
 * Laid where it would be SEEN, which is where the gate saw its own: standing in
 * the openest sky of the bearing, because a slab buried inside an opaque bank
 * adds no coverage at all and tests nothing. The column is chosen by the frame
 * rather than named, so the test does not quietly stop testing when the
 * composition moves.
 */
function layTestSlab(cover, pitch) {
  const out = Float32Array.from(cover);
  const wide = Math.max(2, Math.round(SLAB_DEG / (POSE.fov / H)));
  const rowOf = (el) => Math.round((0.5 - (el - pitch) / POSE.fov) * H);
  const y0 = Math.max(0, rowOf(SLAB_ELEVATIONS[1]));
  const y1 = Math.min(H - 1, rowOf(SLAB_ELEVATIONS[0]));
  let x0 = 0;
  let quietest = Infinity;
  for (let x = BAR_FAR; x + wide < W - BAR_FAR; x++) {
    let sum = 0;
    for (let y = y0; y <= y1; y++) {
      for (let k = 0; k < wide; k++) sum += out[y * W + x + k];
    }
    if (sum < quietest) { quietest = sum; x0 = x; }
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x < x0 + wide; x++) out[y * W + x] = Math.min(1, out[y * W + x] + SLAB_COVER);
  }
  return { cover: out, rows: y1 - y0 + 1, column: x0 };
}

// ---------------------------------------------------------------- the library

/**
 * How much of its own envelope a piece's body fills.
 *
 * The falx test. A cumulus is a heap: convex to a good approximation, as wide as
 * the shape it makes, and one run of cloud whichever way it is sliced. What the
 * client photographed instead, at two and a half times the size it was cut, was
 * a smooth concave arc — a thin bow with a large empty bay inside it, which the
 * eye reads as a brush stroke and never as weather. Enlarged is exactly when it
 * stops reading: at the scale it was cut the arc is one lobe of a bank with the
 * rest of the bank around it; laid down alone at two and a half it is the arc.
 *
 * So the body is charged for its own envelope along both axes. Each row of it
 * pays the whole distance from its first solid texel to its last, and each
 * column likewise; a heap pays almost nothing, because there is nothing between
 * its two edges but itself, and a bow pays for its whole bay. The worse of the
 * two axes is the answer, because a bow on its side is still a bow.
 *
 * @returns {number} the body's area over its envelope, one for a heap
 */
function bodyFill(alpha, x, y, pw, ph) {
  const w = pw >> 1;
  const h = ph >> 1;
  const solid = new Uint8Array(w * h);
  let area = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (alpha[(y + j * 2) * W + x + i * 2] <= 0.6) continue;
      solid[j * w + i] = 1;
      area++;
    }
  }
  if (!area) return 0;
  const spanned = (outer, inner, at) => {
    let total = 0;
    for (let a = 0; a < outer; a++) {
      let first = -1;
      let last = -1;
      for (let b = 0; b < inner; b++) {
        if (!solid[at(a, b)]) continue;
        if (first < 0) first = b;
        last = b;
      }
      if (first >= 0) total += last - first + 1;
    }
    return total;
  };
  const rows = spanned(h, w, (j, i) => j * w + i);
  const cols = spanned(w, h, (i, j) => j * w + i);
  return area / Math.max(1, Math.max(rows, cols));
}

/**
 * Pieces of the reference worth laying down somewhere else.
 *
 * A piece is kept when it carries cloud over much of its area, when its coverage
 * actually varies — which is what tells a cumulus from a flat haze — and, above
 * all, when its coverage falls away at its own rim. That last one is the whole
 * of the ring problem: a piece cut through the middle of a solid cumulus has
 * cloud to its edges, and faded out so those edges do not show it becomes a disc
 * with a halo. A piece whose rim is already sky has a shape of its own.
 *
 * And it needs a BODY. Variance alone passes a window of thin veil that never
 * reaches anywhere near solid: laid down small it has no silhouette to read, so
 * what the eye finds is the only shape it has left, which is the shape of the
 * window it was cut in. Two of the five smallest pieces of the first library
 * were exactly that — a pale patch, very nearly square — and this is the test
 * that does not choose them.
 */
// The windows the library is looked for through.
//
// Five sizes rather than four, and each of them in three shapes. A cumulus is
// not square: a window half as tall again as it is wide takes a LOBE out of a
// bank where a square one takes the bank, and a lobe of a bank is a legitimate
// piece of weather that is not the bank it came from. Four square sizes returned
// six pieces for twenty seven placements — one of them standing six times round
// the compass, two of them the same cloud at two scales — and the reviewer found
// them in the panorama in the order they were laid.
// Largest first, and that order is load bearing: the pieces are taken a window
// at a time and every one has to be unlike everything already taken, so whoever
// goes first sets the shapes. A bank has a shape a lobe of it can be told from;
// a lobe taken first rules the bank out and leaves a sky of small clouds.
const LIBRARY_WINDOWS = [11.5, 9.0, 7.0, 5.5, 4.0]
  .flatMap((size) => [[1, 1], [1.4, 0.85], [0.85, 1.4]]
    .map(([fw, fh]) => ({ w: size * fw, h: size * fh, band: size })));

// How many distinct pieces the library is asked for.
//
// Fourteen rather than six, and the number is not a wish: the two hundred and
// eighty seven degrees the photograph never showed are under four fields of
// view, so twenty seven placements out of a pool of fourteen is twice each, and
// twice each is what lets no piece stand twice in one frame.
const LIBRARY_WANTED = 20;

// AND THE WINDOWS THE RESERVE BEHIND THE BLOCKS IS LOOKED FOR THROUGH.
//
// The unit before this one could fill one hole out of two, and the reason it
// gave was arithmetic rather than taste: nineteen pieces, of which eighteen were
// eligible, twenty seven placements, and a cap of once for a whole cloud and
// twice for anything else. Every piece was already standing as often as it may,
// so the hole the photograph frames most tightly of all — the first block, with
// three tenths of coverage in the ring round it — kept its gap for want of
// material, not for want of a rule.
//
// So the photograph is asked for MORE PIECES, at exactly the same quality. Not
// one threshold below moves: a piece still needs its body, its heap, its lift
// over its own clear sky, its blue, and it still has to be unlike everything
// already taken by the same correlation at the same gate. What moves is where
// the search LOOKS — sizes between the ones it had, and two more shapes per
// size. A window at four fifths of a size is a different crop of this sky, and a
// crop this search never tried is the one thing that can add a piece without
// letting a worse one through.
//
// These pieces are the holes' own reserve and stand nowhere else. That is not
// modesty about their quality — they passed the same gates — it is the promise
// the unit before this one made and the gates certified: the twenty seven
// bearings outside the sector were planned from a pool of a stated size in a
// stated order, and a piece inserted into that pool deals the whole sky again.
// The reserve is taken AFTER the pool is closed, so the pool is the pool it was,
// and the plan that reads it comes out placement for placement identical.
// Sizes a quarter of a degree apart rather than the pool's five wide steps, and
// five shapes at each of them. What this photograph will not do is give a
// SECOND large piece: read through fourteen fresh windows between eight and
// eleven degrees it returned three, because every large crop of a sky with two
// banks in it correlates with a crop already taken and the likeness gate is not
// moved for a hole. What it will give is the middle sizes, which is what a hole
// nine degrees across wants anyway.
const HOLE_WINDOWS = [
  ...[10.2, 9.6, 8.6, 8.0, 7.4, 6.6, 6.2, 5.8, 5.2, 4.7, 4.3, 3.9, 3.4, 3.0]
    .flatMap((size) => [[1, 1], [1.4, 0.85], [0.85, 1.4], [1.25, 0.8], [0.8, 1.25]]
      .map(([fw, fh]) => ({ w: size * fw, h: size * fh, band: size }))),
  ...[11.5, 9.0, 7.0, 5.5, 4.0].flatMap((size) => [[1.25, 0.8], [0.8, 1.25]]
    .map(([fw, fh]) => ({ w: size * fw, h: size * fh, band: size }))),
];

// How many pieces that reserve is asked for: everything the photograph will
// give at this quality, because what it gives is well under what is asked and
// the honest answer is the count rather than the wish. A piece the plan does not
// lay is cut and thrown away — a few seconds of bake and not one byte shipped.
const HOLE_RESERVE = 40;

// WHEN A PIECE IS TOO RECOGNISABLE TO STAND TWICE.
//
// The ninth gate read one of them off the panorama by name — a hooked cloud with
// a bright crescent rim, which the reviewer met at three of the twelve bearings
// — and the anti-twin rule below had nothing to say about it, because that rule
// is about two of one piece being ON THE SCREEN together and this was not. It
// was simply memorable. A walker who turns round the compass meets it three
// times over half a minute and knows it every time.
//
// So distinctiveness is added to the selection, and it is defined the way the
// evidence forced rather than the way intuition first suggested. The shape
// statistics all said the wrong thing: measured on the eleven pieces of that
// library, the hook was among the MOST compact, the MOST solid and the thickest
// of them. That is not a coincidence, it is the answer. What the eye remembers
// is not a strange outline, it is A WHOLE CLOUD: one mass, filling its own
// envelope, hanging together, with a rim of its own all the way round. A ragged
// fragment of a bank reads as "some cloud" and is forgotten; a complete little
// cumulus reads as a thing, and a thing can be met again.
//
// Both figures are ones the selection already measures. A piece over both of
// them stands ONCE.
const DISTINCT_FILL = 0.80;
const DISTINCT_HANGS = 0.85;

// How alike two pieces may look before they are one piece.
//
// Measured as the correlation of their coverage — the SHAPE of it, with the mean
// and the amplitude taken out, because a piece is rescaled before it is laid —
// over the mirror the placement can apply and a fifth of a window of slide
// either way. Two crops of one turret score above nine tenths, a lobe of a bank
// against the bank about a half, two different clouds under a third; and this
// photograph does not hold fourteen unrelated clouds, so the gate is set where
// the panorama stops showing a pair rather than where the arithmetic is tidy.
const LIBRARY_SAME = 0.72;

// The thumbnail the resemblance is read from, and how far it is slid.
const THUMB = 16;
const THUMB_SLIDE = 3;

/** A window's coverage, boiled down to the thumbnail the likeness test runs on. */
function thumbnail(alpha, x, y, pw, ph) {
  const out = new Float32Array(THUMB * THUMB);
  for (let j = 0; j < THUMB; j++) {
    const j0 = Math.floor(j * ph / THUMB);
    const j1 = Math.max(j0 + 1, Math.floor((j + 1) * ph / THUMB));
    for (let i = 0; i < THUMB; i++) {
      const i0 = Math.floor(i * pw / THUMB);
      const i1 = Math.max(i0 + 1, Math.floor((i + 1) * pw / THUMB));
      let sum = 0;
      let n = 0;
      for (let b = j0; b < j1; b++) {
        for (let a = i0; a < i1; a++) { sum += alpha[(y + b) * W + x + a]; n++; }
      }
      out[j * THUMB + i] = sum / n;
    }
  }
  let mean = 0;
  for (let i = 0; i < out.length; i++) mean += out[i];
  mean /= out.length;
  let norm = 0;
  for (let i = 0; i < out.length; i++) { out[i] -= mean; norm += out[i] * out[i]; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/**
 * How alike two pieces look.
 *
 * The best correlation over the two ways the placement can turn one piece into
 * the other — as cut and mirrored, the roll being far short of a quarter turn —
 * and over a slide of up to a fifth of a window, which is what makes this a test
 * of the material rather than of where the window happened to fall.
 */
function resemblance(a, b) {
  let best = -1;
  for (const mirror of [false, true]) {
    for (let dy = -THUMB_SLIDE; dy <= THUMB_SLIDE; dy++) {
      for (let dx = -THUMB_SLIDE; dx <= THUMB_SLIDE; dx++) {
        let sum = 0;
        let n = 0;
        for (let j = 0; j < THUMB; j++) {
          const t = j + dy;
          if (t < 0 || t >= THUMB) continue;
          for (let i = 0; i < THUMB; i++) {
            const s = i + dx;
            if (s < 0 || s >= THUMB) continue;
            sum += a[j * THUMB + i] * b[t * THUMB + (mirror ? THUMB - 1 - s : s)];
            n++;
          }
        }
        // Back to the scale a full overlap would have had, so a slide is not
        // rewarded for comparing fewer cells.
        if (n) best = Math.max(best, sum * (THUMB * THUMB) / n);
      }
    }
  }
  return best;
}

/**
 * The largest piece of a window's body that hangs together.
 *
 * A cumulus has a body: one mass, with lobes on it. What the first library
 * called a piece twice over was a LACE — a hundred specks of solid with sky
 * between them, which reads at the size it was cut and reads as lichen the
 * moment it is laid down at twice that. The test is the obvious one: how much of
 * the solid is in its biggest connected part.
 */
function bodyShare(alpha, x, y, pw, ph) {
  const w = pw >> 1;
  const h = ph >> 1;
  const solid = new Uint8Array(w * h);
  let total = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (alpha[(y + j * 2) * W + x + i * 2] <= 0.6) continue;
      solid[j * w + i] = 1;
      total++;
    }
  }
  if (!total) return { largest: 0, share: 0 };
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let largest = 0;
  for (let start = 0; start < w * h; start++) {
    if (!solid[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let size = 0;
    while (top > 0) {
      const p = stack[--top];
      size++;
      const py = (p / w) | 0;
      const px = p - py * w;
      const near = [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1,
        py > 0 ? p - w : -1, py < h - 1 ? p + w : -1];
      for (const q of near) {
        if (q < 0 || seen[q] || !solid[q]) continue;
        seen[q] = 1;
        stack[top++] = q;
      }
    }
    largest = Math.max(largest, size);
  }
  return { largest: largest / (w * h), share: largest / total };
}

/**
 * Pieces of the reference worth laying down somewhere else.
 *
 * A piece is kept when it carries cloud over much of its area, when its coverage
 * actually varies — which is what tells a cumulus from a flat haze — and, above
 * all, when its coverage falls away at its own rim. That last one is the whole
 * of the ring problem: a piece cut through the middle of a solid cumulus has
 * cloud to its edges, and faded out so those edges do not show it becomes a disc
 * with a halo. A piece whose rim is already sky has a shape of its own.
 *
 * And it needs a BODY. Variance alone passes a window of thin veil that never
 * reaches anywhere near solid: laid down small it has no silhouette to read, so
 * what the eye finds is the only shape it has left, which is the shape of the
 * window it was cut in. It needs that body to HANG TOGETHER, or what is laid
 * down is a lichen. It has to be the colour of cloud: this frame's upper
 * left is deep blue behind a dark veil, and a window of that separates into a
 * coverage like a cumulus's and a colour like nothing in any sky — which is
 * exactly the piece the reviewer picked out of the panorama by name.
 *
 * The pieces are then chosen ACROSS the sizes rather than within each one. Bands
 * that choose separately choose the same cloud four times over — the old library
 * held one turret at four sizes and called it four pieces — so the likeness test
 * runs against everything already taken, whatever window it came out of, and the
 * sizes take turns so the pool still spans them.
 */
function findLibrary(material, {
  windows = LIBRARY_WINDOWS, wanted = LIBRARY_WANTED,
  reserveWindows = HOLE_WINDOWS, reserve = HOLE_RESERVE,
} = {}) {
  const {
    alpha, colour, stone, ground, fit,
  } = material;
  const clear = [0, 0, 0];
  const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const scan = (list) => list.map((win) => {
    const candidates = [];
    // Stepped in frame pixels at the rate the reference itself carries, which
    // is what decides how many windows there are to try, not how finely the
    // chosen ones are then written.
    const pw = Math.round(win.w * 22);
    const ph = Math.round(win.h * 22);
    const step = Math.max(4, Math.round(Math.min(pw, ph) * 0.10));
    for (let y = 0; y + ph <= H; y += step) {
      for (let x = 0; x + pw <= W; x += step) {
        let whole = true;
        let sum = 0;
        let sum2 = 0;
        let n = 0;
        let core = 0;
        let coreN = 0;
        let solid = 0;
        let body = 0;
        let warm = 0;
        let blue = 0;
        // Per side, not averaged over the rim.
        //
        // A mean over the whole border passes a piece with three sides of sky
        // and one of solid cumulus, and that one side is a straight edge in the
        // sky the moment the piece is laid down — which is exactly what the
        // first panorama showed, at half a dozen bearings.
        const sides = [0, 0, 0, 0];
        const sideN = [0, 0, 0, 0];
        const rimU = Math.max(2, Math.round(pw * 0.12));
        const rimV = Math.max(2, Math.round(ph * 0.12));
        for (let j = 0; j < ph && whole; j += 2) {
          for (let i = 0; i < pw; i += 2) {
            const o = (y + j) * W + x + i;
            if (stone[o] || ground[o]) { whole = false; break; }
            const v = alpha[o];
            sum += v; sum2 += v * v; n++;
            if (v > 0.6) {
              solid++;
              // Where the coverage is solid the stored colour IS the radiance,
              // because what is stored is the difference from a sky that is no
              // longer showing through.
              body += luma([colour[o * 3], colour[o * 3 + 1], colour[o * 3 + 2]]) / v;
              warm += colour[o * 3] / v;
              blue += colour[o * 3 + 2] / v;
            }
            if (i < rimU) { sides[0] += v; sideN[0]++; }
            if (j < rimV) { sides[1] += v; sideN[1]++; }
            if (i >= pw - rimU) { sides[2] += v; sideN[2]++; }
            if (j >= ph - rimV) { sides[3] += v; sideN[3]++; }
            if (Math.min(i, pw - 1 - i) > pw * 0.3 && Math.min(j, ph - 1 - j) > ph * 0.3) {
              core += v; coreN++;
            }
          }
        }
        if (!whole || n < 16) continue;
        const mean = sum / n;
        const variance = Math.max(0, sum2 / n - mean * mean);
        if (mean < 0.18 || mean > 0.88) continue;
        if (variance < 0.010) continue;
        if ((coreN ? core / coreN : 0) < 0.40) continue;
        // A body, and not only a variation: what survives the radial matte of a
        // piece with no solid in it is a wash, and a wash laid down small is a
        // rectangle.
        if (solid / n < BODY_SHARE) continue;
        // And that body has to be a cloud rather than a haze: brighter than the
        // sky it stands in front of, by the margin a cumulus has.
        const d = ray(x + pw / 2, y + ph / 2);
        clearSkyAt(fit.params, fit.sun, Math.asin(Math.max(-1, Math.min(1, d[1]))) / DEG,
          Math.atan2(d[0], -d[2]) / DEG, clear);
        const lift = body / solid / Math.max(1e-4, luma(clear));
        if (lift < CLOUD_LIFT) continue;
        const cool = blue / Math.max(1e-6, warm);
        if (cool < CLOUD_BLUE) continue;
        const hangs = bodyShare(alpha, x, y, pw, ph);
        if (hangs.share < BODY_TOGETHER) continue;
        // A heap rather than a bow.
        const fill = bodyFill(alpha, x, y, pw, ph);
        if (fill < BODY_HEAP) continue;
        candidates.push({
          fill,
          x,
          y,
          pw,
          ph,
          band: win.band,
          mean,
          variance,
          rim: Math.max(...sides.map((s, k) => (sideN[k] ? s / sideN[k] : 1))),
          solid: solid / n,
          hangs: hangs.share,
          lift,
          cool,
        });
      }
    }
    // Free rimmed pieces first, and only where a band cannot fill itself that
    // way is the rim allowed to carry cloud. What a rimmed piece costs is a disc
    // with a halo round it, so the relaxation is recorded rather than hidden.
    // The rim is a preference now, not a gate: the radial matte is what makes a
    // piece safe to lay down, and a quiet rim only means it has less to erode.
    const quiet = candidates.filter((c) => c.rim <= 0.34);
    const pool = quiet.length >= 4 ? quiet : candidates.filter((c) => c.rim <= 0.60);
    pool.sort((p, q) => q.variance - p.variance);
    return { win, candidates: candidates.length, pool, relaxed: quiet.length < 4 };
  });
  const bands = scan(windows);

  // Taken across the sizes, a turn each, so the pool spans them without any one
  // of them choosing the same cloud its neighbour already took.
  const chosen = [];
  const takeFrom = (list, cursor, limit, passes) => {
    for (let pass = 0; chosen.length < limit && pass < passes; pass++) {
      const band = list[pass % list.length];
      const k = pass % list.length;
      let took = false;
      while (cursor[k] < band.pool.length && !took) {
        const c = band.pool[cursor[k]++];
        c.thumb = thumbnail(alpha, c.x, c.y, c.pw, c.ph);
        let worst = -1;
        for (const other of chosen) worst = Math.max(worst, resemblance(c.thumb, other.thumb));
        if (worst > LIBRARY_SAME) continue;
        c.likeness = worst;
        chosen.push(c);
        took = true;
      }
    }
  };
  const cursor = bands.map(() => 0);
  takeFrom(bands, cursor, wanted, 400);

  // THE POOL IS NOW CLOSED, and what follows can only be added after it.
  //
  // Everything above this line is the library the certified composition was
  // dealt from, and it is left standing: the same windows in the same order
  // taking the same pieces, so planPlacements draws the same twenty seven. The
  // reserve below goes on the end of the list, is looked for through the extra
  // windows as well as through whatever the pool's own bands still had, and is
  // held to every gate the pool was — the likeness test included, run against
  // the pool and against the rest of the reserve alike.
  const reserved = chosen.length;
  const spare = reserve > 0 ? scan(reserveWindows) : [];
  if (spare.length) {
    const all = [...bands, ...spare];
    takeFrom(all, [...cursor, ...spare.map(() => 0)], wanted + reserve, all.length * 30);
  }

  const found = chosen.map((c, k) => ({
    id: `lib-${k}`,
    kind: 'library',
    box: [c.x, c.y, c.x + c.pw, c.y + c.ph],
    mean: c.mean,
    variance: c.variance,
    rim: c.rim,
    // One mass, filling its own envelope: a whole cloud, and a whole cloud is
    // a thing the eye can meet twice and know. Carried on the spec so the plan
    // below can lay it once and no more.
    distinct: c.fill >= DISTINCT_FILL && c.hangs >= DISTINCT_HANGS,
    // Whether this piece belongs to the pool the certified composition was dealt
    // from, or to the reserve that may only stand behind a block. See the essay
    // at HOLE_WINDOWS: the flag is what keeps the twenty seven identical.
    holesOnly: k >= reserved,
    grow: 24,
  }));
  for (const band of [...bands, ...spare]) {
    const kept = chosen.filter((c) => c.pw === Math.round(band.win.w * 22)
      && c.ph === Math.round(band.win.h * 22));
    log(`library window ${band.win.w.toFixed(1)}x${band.win.h.toFixed(1)} deg: `
      + `${band.candidates} candidates${band.relaxed ? ' (rim relaxed)' : ''}, `
      + `${kept.length} kept`);
  }
  log(`library: ${found.length} distinct pieces — ${reserved} in the pool the whole sky is `
    + `dealt from, ${found.length - reserved} held in reserve for the holes `
    + `(${reserve} asked for); worst likeness to anything already `
    + `taken ${Math.max(0, ...chosen.map((c) => c.likeness)).toFixed(2)} `
    + `(same piece above ${LIBRARY_SAME})`);
  log(`  body hangs together ${chosen.map((c) => c.hangs.toFixed(2)).join(' ')}`);
  log(`  body fills its envelope ${chosen.map((c) => c.fill.toFixed(2)).join(' ')} `
    + `(a bow is dropped below ${BODY_HEAP})`);
  log(`  body over its own clear sky ${chosen.map((c) => c.lift.toFixed(1)).join(' ')}`);
  log(`  body blue over red ${chosen.map((c) => c.cool.toFixed(2)).join(' ')}`);
  log(`  whole clouds, which stand once each (fill over ${DISTINCT_FILL} and hanging `
    + `together over ${DISTINCT_HANGS}): `
    + `${found.filter((f) => f.distinct).map((f) => f.id).join(' ') || 'none'}`);
  return found;
}

// ------------------------------------------------------------- the other sky

// Bearings the photograph reaches, near enough: the frame spans a little over
// seventy two degrees and the masses cut from it stand inside that. Outside it
// there is no measurement at all, and every degree of it is in the frame the
// moment the walker turns round.
const SECTOR = [-38, 37];

/**
 * Where the reference frame reaches, on the sphere.
 *
 * Measured round the frame's own perimeter rather than quoted: a rectilinear
 * frame's corners reach further round than its centre row — seventy four and a
 * half degrees of bearing against seventy two and three quarters — and the
 * corner is exactly what the top left of this picture is.
 */
function poseWindow() {
  let azMin = 180;
  let azMax = -180;
  let elMin = 90;
  let elMax = -90;
  const consider = (px, py) => {
    const d = ray(px, py);
    const az = Math.atan2(d[0], -d[2]) / DEG;
    const el = Math.asin(Math.max(-1, Math.min(1, d[1]))) / DEG;
    azMin = Math.min(azMin, az); azMax = Math.max(azMax, az);
    elMin = Math.min(elMin, el); elMax = Math.max(elMax, el);
  };
  for (let x = 0; x < W; x++) { consider(x, 0); consider(x, H - 1); }
  for (let y = 0; y < H; y++) { consider(0, y); consider(W - 1, y); }
  return {
    azMin, azMax, elMin, elMax,
  };
}

const POSE_WINDOW = poseWindow();

/**
 * The runtime's own weather constants, parsed rather than repeated.
 *
 * A piece has to be placed against where it will BE and not only against where
 * it is laid, so this tool needs the drift the shader applies; and a second copy
 * of a number is a second chance for two files to disagree about it. Parsed for
 * the same reason framing.mjs parses the pose: clouds.js belongs to the runtime
 * and pulls three with it, which has no business inside a build tool.
 */
function readDrift() {
  const source = readFileSync(join(REPO_ROOT, 'src', 'world', 'clouds.js'), 'utf8');
  const number = (name) => {
    const found = new RegExp(`const ${name} = (-?[0-9.]+)`).exec(source);
    if (!found) throw new Error(`${name} not found in src/world/clouds.js`);
    return Number(found[1]);
  };
  return {
    rate: number('DRIFT_RATE_DEG'),
    arcLibrary: number('ARC_LIBRARY_DEG'),
    arcMass: number('ARC_MASS_DEG'),
    churn: number('CHURN_AMP'),
  };
}

const DRIFT = readDrift();

// What a free piece keeps between itself and the sector the photograph owns.
//
// The saturating drift is not in here: it is counted in the footprint below,
// because it is not a margin — it is where the piece goes. This is what is left
// over: half a degree of plain distance so that nothing depends on a third
// decimal place, and the churn, which is stated as a share of the piece's own
// axis because that is what it is.
const POSE_CLEARANCE_DEG = 0.5;

/**
 * Where a placement reaches, over the whole of its life.
 *
 * Round the perimeter rather than at the corners, because a quad wide enough to
 * matter is bent by the sphere and its highest point is in the middle of an edge
 * rather than at either end of it.
 *
 * The drift is part of the footprint. It turns the whole field one way about the
 * vertical and never back — the excursion is a tanh, which is monotone and
 * positive — so a piece laid to the west of the frame walks TOWARDS it for as
 * long as the session lasts, and a rule written against where it was laid is a
 * rule about the first frame only.
 */
function placementFootprint(p) {
  const halfU = p.tile.halfU * p.scale;
  const halfV = p.tile.halfV * p.scale;
  const { c, right, up } = tileBasis(p.azimuth, p.elevation);
  const roll = (p.roll || 0) * DEG;
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  let azMin = 180;
  let azMax = -180;
  let elMin = 90;
  let elMax = -90;
  const consider = (s, t) => {
    const u = (s * cr - t * sr) * halfU;
    const v = (s * sr + t * cr) * halfV;
    const d = [
      c[0] + u * right[0] + v * up[0],
      c[1] + u * right[1] + v * up[1],
      c[2] + u * right[2] + v * up[2],
    ];
    const len = Math.hypot(d[0], d[1], d[2]);
    const el = Math.asin(Math.max(-1, Math.min(1, d[1] / len))) / DEG;
    let delta = Math.atan2(d[0] / len, -d[2] / len) / DEG - p.azimuth;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    azMin = Math.min(azMin, delta); azMax = Math.max(azMax, delta);
    elMin = Math.min(elMin, el); elMax = Math.max(elMax, el);
  };
  for (let k = 0; k <= 24; k++) {
    const f = -1 + 2 * (k / 24);
    consider(f, -1); consider(f, 1); consider(-1, f); consider(1, f);
  }
  const margin = POSE_CLEARANCE_DEG
    + DRIFT.churn * Math.max(azMax - azMin, elMax - elMin) / 2;
  return {
    azMin: p.azimuth + azMin - margin,
    azMax: p.azimuth + azMax + DRIFT.arcLibrary + margin,
    elMin: elMin - margin,
    elMax: elMax + margin,
  };
}

/** Whether two arcs of bearing meet, on a circle rather than on a line. */
function arcsMeet(a, b) {
  const halfA = (a.azMax - a.azMin) / 2;
  const halfB = (b.azMax - b.azMin) / 2;
  let apart = (a.azMax + a.azMin) / 2 - (b.azMax + b.azMin) / 2;
  while (apart > 180) apart -= 360;
  while (apart < -180) apart += 360;
  return Math.abs(apart) < halfA + halfB;
}

/**
 * The "the photograph's own sector belongs to the photograph" invariant.
 *
 * Everything inside the reference frame is a mass cut from that frame at the
 * bearing it was photographed at, and what stands there is the reference's own
 * pixels. A free piece — laid at a bearing nobody photographed, rolled, mirrored
 * and rescaled — that reaches into the frame puts invention where measurement
 * belongs, and the corner of this frame is deep blue: a piece over it is not a
 * near miss, it is fifty units of colour and the welcome text underneath it.
 *
 * Checked here rather than discovered in a screenshot, and the bake fails on it.
 *
 * @returns {string[]} one complaint per trespass, empty when the sector is clear
 */
function checkPoseFootprint(placements) {
  const complaints = [];
  for (const p of placements) {
    const f = placementFootprint(p);
    if (f.elMax < POSE_WINDOW.elMin || f.elMin > POSE_WINDOW.elMax) continue;
    if (!arcsMeet(f, POSE_WINDOW)) continue;
    complaints.push(`${p.id} (${p.tile.id} at az ${p.azimuth.toFixed(2)} el `
      + `${p.elevation.toFixed(2)} scale ${p.scale.toFixed(2)}) reaches az `
      + `${f.azMin.toFixed(1)}..${f.azMax.toFixed(1)} el ${f.elMin.toFixed(1)}..`
      + `${f.elMax.toFixed(1)} once the drift is spent, which is inside the reference `
      + `frame (az ${POSE_WINDOW.azMin.toFixed(1)}..${POSE_WINDOW.azMax.toFixed(1)} el `
      + `${POSE_WINDOW.elMin.toFixed(1)}..${POSE_WINDOW.elMax.toFixed(1)}): `
      + 'lay it further out or smaller');
  }
  return complaints;
}

// How many pieces the rest of the sky is laid with.
//
// Enough that the bands carry the coverage the reference carries at the same
// height, and no more: past that the sky fills in, and a sky that is full
// everywhere is as much of a machine as a sky with its blobs at equal intervals.
const PLACEMENTS = 27;

/** Coverage of the reference against height, over the sky it actually shows. */
function coverageByBand(material) {
  const { alpha, stone, ground } = material;
  const bands = [];
  const ray2 = makeRay();
  const DEGS = [2, 6, 10, 14, 18, 22, 26];
  const sums = DEGS.map(() => ({ sum: 0, n: 0 }));
  for (let y = 0; y < 560; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (stone[i] || ground[i]) continue;
      const d = ray2(x, y);
      const el = Math.asin(Math.max(-1, Math.min(1, d[1]))) / DEG;
      const k = DEGS.findIndex((e) => Math.abs(el - e) <= 2);
      if (k < 0) continue;
      sums[k].sum += alpha[i];
      sums[k].n++;
    }
  }
  for (let k = 0; k < DEGS.length; k++) {
    bands.push({ elevation: DEGS[k], cover: sums[k].n ? sums[k].sum / sums[k].n : 0 });
  }
  return bands;
}

// One field of view, as the frame itself measures it: what a standing walker can
// have on the screen at once.
const FIELD_OF_VIEW = POSE_WINDOW.azMax - POSE_WINDOW.azMin;

// When two placements of one piece are ALIKE, stated rather than felt.
//
// The same mirror — which decides which way a lit edge faces, and is the first
// thing the eye reads off a cumulus — and a roll within twenty degrees, which at
// these sizes is under the width of one turret. Anything inside both of those is
// the same cloud drawn twice, whatever its scale.
const ALIKE_ROLL_DEG = 20;

/**
 * Whether two placements of one piece read as twins.
 *
 * Inside one field of view the answer is yes whatever the two poses are: they
 * are on the screen together, and no roll and no mirror survives being seen side
 * by side. Out to two fields of view — one turn of the head, with the first out
 * of sight before the second is in it — they are twins when they are alike.
 * Beyond that the sky is allowed to have the same weather in it twice, which is
 * what a sky does.
 */
function twins(a, b) {
  let apart = a.azimuth - b.azimuth;
  while (apart > 180) apart -= 360;
  while (apart < -180) apart += 360;
  apart = Math.abs(apart);
  if (apart < FIELD_OF_VIEW) return true;
  if (apart >= FIELD_OF_VIEW * 2) return false;
  return a.flip === b.flip && Math.abs(a.roll - b.roll) < ALIKE_ROLL_DEG;
}

/**
 * The "no piece stands twice in one frame" invariant.
 *
 * The reviewer read the old library off the panorama by name: one piece four
 * times, twice of it six degrees apart facing the same way; another four times
 * inside thirty degrees; a third twice at seven degrees with the same mirror.
 * None of that was forbidden, because nothing was checking.
 *
 * @returns {string[]} one complaint per pair, empty when no two are twins
 */
function checkTwins(placements) {
  const complaints = [];
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i];
      const b = placements[j];
      if (a.tile !== b.tile || !twins(a, b)) continue;
      let apart = Math.abs(a.azimuth - b.azimuth);
      if (apart > 180) apart = 360 - apart;
      complaints.push(`${a.id} and ${b.id} are the same piece ${apart.toFixed(1)} deg apart `
        + `(roll ${a.roll.toFixed(0)} and ${b.roll.toFixed(0)}, mirror ${a.flip} and ${b.flip}), `
        + `inside a field of view of ${FIELD_OF_VIEW.toFixed(1)} deg`);
    }
  }
  return complaints;
}

// -------------------------------------------------- the sky behind a block

// WHERE THE PHOTOGRAPH DID NOT SEE, ONE THING MAY BE PUT AFTER ALL.
//
// The unit before this one took the invention out of the holes and left them as
// sky, and it was right to: a region invented against a region measured differs
// over exactly the shape that separated them, and that shape is a monolith. What
// it left behind is the same shape drawn the other way round. Standing twelve
// metres east, the hero bank carries a notch of clear sky with two vertical
// flanks, a level floor and the rounded corners of the block that made it; the
// carry brings the coverage to nothing over a degree, so there is no step
// anywhere and the outline is still legible, because the outline is not a step,
// it is a SHAPE. No photographic quantity can cure it — along that border the
// photograph is uniformly dense, so nothing measured varies there, and anything
// that made the contour wander would be the invention all over again.
//
// So the rule that forbade the cure is amended, in one place, with a reason that
// belongs only to that place. A HOLE IS THE ONE PART OF THIS PICTURE THE
// PHOTOGRAPH DOES NOT SHOW. Everywhere else in the reference's own sector the
// invariant above is absolute — what stands there is the reference's own pixels,
// and a free piece laid over them is fifty units of colour where a measurement
// belongs. Behind a block there are no pixels to respect. A piece of the
// library, which is the photograph's own weather cut somewhere else, may
// therefore stand there, and the frame the reference was judged on does not
// change by so much as a bit, because the block is drawn in front of it.
//
// That is a licence with three conditions, and they are not good intentions —
// they are the invariant below, and the bake fails on them.
//
//   IT IS INVISIBLE AT THE REFERENCE POSE. Not "very nearly": the frame at the
//   reference pose is byte identical with the piece and without it. The piece is
//   hidden by the block for the whole of its life, by construction, and what
//   makes that true rather than likely is the second condition.
//
//   IT NEVER LEAVES THE BLOCK'S OUTLINE. Its quad, sampled round its own
//   perimeter and over the whole of its drift, stays inside the outline the
//   block's own box has in bearing and height, with a clearance to spare; and
//   every one of those directions lands on a pixel the fitted silhouette calls
//   stone and not land — the very texels carryIntoHoles calls a hole.
//
//   AND IT DOES NOT DRIFT. This is not a third rule, it is the second one
//   spent: a block hides nine degrees of sky, the library's own excursion is
//   seven of them and a mass's two and a fifth, and either would go on the
//   piece's freedom to move rather than on the piece. A piece behind a block is
//   given the excursion its licence affords, which is none, and it lives on the
//   churn — which is what every mass in this sky is living on two minutes after
//   the walker arrives, once the translation has saturated. The number is still
//   charged for in the footprint below rather than assumed away, so the day
//   somebody gives one an arc, the invariant charges for it.
//
// Everything else stands: distinctness, the anti-twin rule, the straight cuts,
// the bars from the walk, both skies. A piece in a hole is a placement like any
// other and is read by every one of them.

/**
 * The blocks of the world, and the eye the cloud field is anchored to.
 *
 * Parsed rather than imported, for the same reason readDrift parses the runtime
 * and framing.mjs parses the pose: layout.js belongs to the scene and pulls it
 * with it, and a second copy of a monolith's footprint is a second chance for
 * two files to disagree about where the sky is hidden.
 */
function readBlocks() {
  const source = readFileSync(join(REPO_ROOT, 'src', 'world', 'layout.js'), 'utf8');
  const platform = /export const PLATFORM = \{([\s\S]*?)\};/.exec(source);
  if (!platform) throw new Error('PLATFORM not found in src/world/layout.js');
  const platformHeight = Number(/height:\s*([0-9.]+)/.exec(platform[1])[1]);
  const eyeHeight = Number(/export const EYE_HEIGHT = ([0-9.]+)/.exec(source)[1]);
  const spawnZ = Number(/export const SPAWN = \{[^}]*z:\s*(-?[0-9.]+)/.exec(source)[1]);
  const found = [...source.matchAll(/id: '(\d\d)',[\s\S]*?position: \{ x: (-?[0-9.]+), z: (-?[0-9.]+) \},[\s\S]*?rotationY: (-?[0-9.]+),[\s\S]*?size: \[([^\]]+)\],\s*\n\s*baseY: ([^,]+),/g)];
  if (found.length < 5) {
    throw new Error(`only ${found.length} monolith(s) parsed out of src/world/layout.js`);
  }
  return {
    eye: [0, eyeHeight, spawnZ],
    blocks: found.map((m) => ({
      id: m[1],
      x: Number(m[2]),
      z: Number(m[3]),
      rotationY: Number(m[4]),
      size: m[5].split(',').map((v) => {
        const t = v.trim();
        // The third block's height is written as its head less the platform it
        // stands on, which is the one expression in that table.
        return t.includes('PLATFORM.height')
          ? Number(t.split('-')[0]) - platformHeight : Number(t);
      }),
      baseY: m[6].trim() === 'PLATFORM.height' ? platformHeight : Number(m[6]),
    })),
  };
}

const WORLD = readBlocks();

/** Convex hull of points in a plane, monotone chain, counter clockwise. */
function hullOf(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2
      && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2
      && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** How far inside a convex polygon a point stands, in degrees; negative outside. */
function depthIn(poly, q) {
  let worst = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    worst = Math.min(worst, (-ey * (q[0] - a[0]) + ex * (q[1] - a[1])) / len);
  }
  return worst;
}

/**
 * The outline, in bearing and height, of the sky each block takes away.
 *
 * The hull of the box's eight corners, which for a convex body seen from outside
 * IS its silhouette. The sixth block stands five metres behind the eye and wraps
 * the whole compass; it hides no sky the reference ever showed, and it is not
 * here.
 */
function blockOutlines() {
  const out = [];
  for (const b of WORLD.blocks) {
    const [w, h, d] = b.size;
    const cos = Math.cos(b.rotationY * DEG);
    const sin = Math.sin(b.rotationY * DEG);
    const pts = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const sy of [0, 1]) {
          const lx = sx * w / 2;
          const lz = sz * d / 2;
          const dx = b.x + lx * cos + lz * sin - WORLD.eye[0];
          const dy = b.baseY + sy * h - WORLD.eye[1];
          const dz = b.z - lx * sin + lz * cos - WORLD.eye[2];
          pts.push([Math.atan2(dx, -dz) / DEG, Math.atan2(dy, Math.hypot(dx, dz)) / DEG]);
        }
      }
    }
    const azMin = Math.min(...pts.map((p) => p[0]));
    const azMax = Math.max(...pts.map((p) => p[0]));
    if (azMax - azMin > 90) continue;
    out.push({
      id: b.id,
      hull: hullOf(pts),
      azMin,
      azMax,
      elMin: Math.min(...pts.map((p) => p[1])),
      elMax: Math.max(...pts.map((p) => p[1])),
    });
  }
  return out;
}

const OUTLINES = blockOutlines();

// How far inside the box's own outline the block the frame DRAWS actually
// stands, in degrees.
//
// The outline above is the box in layout.js; what the frame rasterises is the
// baked mesh, whose edges are eased. Measured rather than assumed, over every
// vertex of all five meshes as the running scene holds them, from this same eye:
// no vertex stands outside the box's hull by more than 0.056 deg, and the hull
// stands outside the mesh by at most 0.096. So a piece inside the hull by a
// tenth of a degree is inside the mesh.
const HOLE_MESH_INSET_DEG = 0.10;

// And what it keeps beyond that, so that nothing depends on a third decimal
// place. The same half degree of plain distance the free pieces keep from the
// reference's sector, less the part of it that was about the drift.
const HOLE_CLEARANCE_DEG = HOLE_MESH_INSET_DEG + 0.25;

// How far inside the fitted silhouette a hole filler's own outline has to land,
// in pixels of the reference frame. Three, which is the width of the gather that
// reads the reference into a tile plus the pixel of stone guard.
const HOLE_GUARD_PX = 3;

// The excursion a piece behind a block is given. See the essay above: none.
const HOLE_ARC_DEG = 0;

// Liftable from the command line, and only so the invariant below can be shown
// FINDING the fault it was built for: grown past one, the piece it laid comes
// out from behind its block and the bake fails on it. A run that ships never
// lifts it.
const HOLE_GROW = Number(process.env.FARFIELD_HOLE_GROW ?? 1);

/**
 * Where a piece laid behind a block reaches, over the whole of its life.
 *
 * Its own perimeter — round it rather than at the corners, because a quad wide
 * enough to matter is bent by the sphere — at every stage of its drift. The
 * churn is charged as a margin by the caller rather than sampled here: it warps
 * the texture inside the quad and the shader clamps it to the tile's own
 * rectangle, so it cannot move the quad at all, and it is paid for anyway.
 */
function holeReach(p) {
  const halfU = p.tile.halfU * p.scale;
  const halfV = p.tile.halfV * p.scale;
  const { c, right, up } = tileBasis(p.azimuth, p.elevation);
  const roll = (p.roll || 0) * DEG;
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const arc = p.arc || 0;
  const steps = arc > 0 ? 8 : 0;
  const out = [];
  for (let k = 0; k <= 24; k++) {
    const f = -1 + 2 * (k / 24);
    for (const [s, t] of [[f, -1], [f, 1], [-1, f], [1, f]]) {
      const u = (s * cr - t * sr) * halfU;
      const v = (s * sr + t * cr) * halfV;
      const d = [
        c[0] + u * right[0] + v * up[0],
        c[1] + u * right[1] + v * up[1],
        c[2] + u * right[2] + v * up[2],
      ];
      const len = Math.hypot(d[0], d[1], d[2]);
      const el = Math.asin(Math.max(-1, Math.min(1, d[1] / len))) / DEG;
      const az = Math.atan2(d[0] / len, -d[2] / len) / DEG;
      for (let j = 0; j <= steps; j++) out.push([az + arc * (steps ? j / steps : 0), el]);
    }
  }
  return out;
}

/**
 * What a hole filler has to keep between itself and the block's own edge.
 *
 * The clearance, and the churn charged exactly as placementFootprint charges it
 * everywhere else — which is a margin it does not strictly owe, since the churn
 * warps the texture inside the quad and the shader clamps the read to the
 * tile's own rectangle, so the quad cannot move at all. It is paid anyway,
 * because one discipline for the whole tool is worth more than a tenth of a
 * degree, and because the day somebody unclamps that read this is what stands
 * between the piece and the daylight.
 */
function holeMargin(p) {
  const spanU = 2 * Math.atan(p.tile.halfU * p.scale) / DEG;
  const spanV = 2 * Math.atan(p.tile.halfV * p.scale) / DEG;
  return HOLE_CLEARANCE_DEG + DRIFT.churn * Math.max(spanU, spanV) / 2;
}

/**
 * The "a piece laid in a hole never leaves it" invariant.
 *
 * The one that carries the derogation. Read on both statements of where the
 * block is, because they are different statements and the piece owes both: the
 * OUTLINE, which is the box the scene is built from and therefore the thing that
 * actually draws in front of the piece; and the SILHOUETTE, which is that box
 * fitted to the reference image and therefore the thing that decides which
 * texels of the photograph are missing. A piece inside the first is hidden at
 * the reference pose; a piece inside the second stands only where the photograph
 * saw nothing, and off the land.
 *
 * @returns {string[]} one complaint per escape, empty when every piece is home
 */
function checkHoleCover(placements, material, { report = null } = {}) {
  const complaints = [];
  const project = makeProjector();
  const { stone, ground } = material;
  for (const p of placements) {
    if (!p.hole) continue;
    const shape = OUTLINES.find((s) => s.id === p.hole);
    if (!shape) {
      complaints.push(`${p.id} is laid behind a block ${p.hole} that does not exist`);
      continue;
    }
    const margin = holeMargin(p);
    let worst = Infinity;
    let at = null;
    let escaped = 0;
    let escapedAt = null;
    for (const [az, el] of holeReach(p)) {
      const depth = depthIn(shape.hull, [az, el]);
      if (depth < worst) { worst = depth; at = [az, el]; }
      const px = project(directionOf(az, el));
      let solid = false;
      if (px) {
        const x = Math.round(px[0]);
        const y = Math.round(px[1]);
        solid = true;
        for (let j = -HOLE_GUARD_PX; j <= HOLE_GUARD_PX && solid; j++) {
          for (let i = -HOLE_GUARD_PX; i <= HOLE_GUARD_PX && solid; i++) {
            const sx = x + i;
            const sy = y + j;
            if (sx < 0 || sx >= W || sy < 0 || sy >= H) { solid = false; break; }
            const o = sy * W + sx;
            if (!stone[o] || ground[o]) solid = false;
          }
        }
      }
      if (!solid) { escaped++; if (!escapedAt) escapedAt = [az, el]; }
    }
    if (report) {
      report.push(`  ${p.id} behind block ${p.hole}: stays ${worst.toFixed(3)} deg inside the `
        + `block's outline, against ${margin.toFixed(3)} it owes `
        + `(${HOLE_CLEARANCE_DEG.toFixed(2)} of clearance and `
        + `${(DRIFT.churn * Math.max(2 * Math.atan(p.tile.halfU * p.scale) / DEG,
          2 * Math.atan(p.tile.halfV * p.scale) / DEG)).toFixed(3)} of churn), `
        + `${escaped ? `${escaped} of its outline off the silhouette` : 'wholly on the silhouette'}`);
    }
    if (worst < margin) {
      complaints.push(`${p.id} (${p.tile.id} at az ${p.azimuth.toFixed(2)} el `
        + `${p.elevation.toFixed(2)} scale ${p.scale.toFixed(2)}) comes within `
        + `${worst.toFixed(3)} deg of the edge of block ${p.hole}'s outline at az `
        + `${at[0].toFixed(2)} el ${at[1].toFixed(2)}, and it owes ${margin.toFixed(3)}: `
        + 'it would show past the block. Lay it smaller or further in');
    }
    if (escaped) {
      complaints.push(`${p.id} (${p.tile.id}) puts ${escaped} of the points of its outline `
        + `off block ${p.hole}'s fitted silhouette, first at az ${escapedAt[0].toFixed(2)} el `
        + `${escapedAt[1].toFixed(2)}: that is sky the photograph DID show, or land, and a free `
        + 'piece may not stand on either');
    }
  }
  return complaints;
}

// How much weather the photograph has to carry round a hole before that hole is
// worth putting anything in.
//
// A hole in clear sky is not a shape, it is clear sky: nothing frames it and
// nothing reads. What draws the block is a bank standing all the way round a
// gap, and this is that, measured — the reference's own coverage in the ring
// from the block's edge out to HOLE_RING_DEG, over the sky it actually shows.
const HOLE_RING_DEG = 2.5;
const HOLE_WEATHER = 0.25;

// What a square degree of bare bite is worth on its own, before the bank across
// the nearest rim is added to it. A third: a cell against solid cloud is worth
// four of a cell in the middle of the bite, which is the order the pieces are
// still laid in, and the middle of the bite is no longer worth nothing.
const HOLE_BASE_WEIGHT = 0.33;

// WHERE THE WALKER CAN ACTUALLY SEE THE BITE FROM.
//
// A hole is the sky one block hides FROM THE REFERENCE EYE. Six metres to the
// side that block has swung a hundred pixels off it — and something else has
// swung ONTO it. At six metres east the first block's bite lands on the screen
// where the SECOND block now stands, and half of it is hidden all over again;
// the fourth block's bite lands behind the fifth. Scored on the bite alone the
// plan puts its pieces in the middle of the hole, which is the one part of it
// nobody on this walk will ever see: measured on the frame, four pieces laid
// that way added LESS light to the notch than the single piece they replaced.
//
// So every cell of the bite is asked what it is worth to somebody standing
// where the walk stands, which is the only place this is ever judged from. The
// standing places are the walk's own, three metres apart either side, and a cell
// is occluded when the ray to it from that eye passes through ANY block and not
// only through the one whose bite it is.
const WALK_STANDS = [-12, -9, -6, -3, 3, 6, 9, 12];

// And what a cell nobody on the walk can see is still worth, because the walk is
// eight standing places and the walker owns the meadow: enough that a piece
// covering it is not thrown away, far too little to choose one.
const HOLE_UNSEEN = 0.15;

// WHEN COVERAGE IS WEATHER AND WHEN IT IS A STAIN.
//
// The first plan to lay several pieces scored them on coverage, straight: a
// hundredth of coverage over a hundred square degrees counted the same as solid
// cloud over one. Measured on the frame that is exactly what it bought — the
// bite came out with two fifths of it "carrying cloud" at a mean of three
// tenths, and the notch went from 58 per cent of its pixels showing nothing to
// 67, because a coverage of two hundredths is half a level of light and the eye
// is looking for a cumulus.
//
// One stored step of coverage at the ceiling is worth some thirty seven levels
// of the delivered frame, so two levels — the least this session's own reading
// of the notch counts — is a coverage of about a twentieth. Under that a piece
// puts nothing there; by a third it is cloud. A placement is worth what it
// brings across that, and a wash is worth what it looks like.
const HOLE_READS = [0.05, 0.30];
const reads = (cover) => smoothstep(HOLE_READS[0], HOLE_READS[1], cover);

/**
 * How much of the walk can see a given direction of sky, from nought to one.
 *
 * The sprite field is anchored to the reference eye and stands nine hundred
 * metres out, so a direction from that eye is a POINT, and where that point
 * lands from another eye is a different direction. That parallax is three
 * quarters of a degree over twelve metres; what moves is not the sky, it is the
 * blocks, by tens of degrees.
 */
function walkSight() {
  const eyes = WALK_STANDS.map((x) => {
    const eye = [x, WORLD.eye[1], WORLD.eye[2]];
    const hulls = [];
    for (const b of WORLD.blocks) {
      const [w, h, d] = b.size;
      const cos = Math.cos(b.rotationY * DEG);
      const sin = Math.sin(b.rotationY * DEG);
      const pts = [];
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          for (const sy of [0, 1]) {
            const lx = sx * w / 2;
            const lz = sz * d / 2;
            const dx = b.x + lx * cos + lz * sin - eye[0];
            const dy = b.baseY + sy * h - eye[1];
            const dz = b.z - lx * sin + lz * cos - eye[2];
            pts.push([Math.atan2(dx, -dz) / DEG, Math.atan2(dy, Math.hypot(dx, dz)) / DEG]);
          }
        }
      }
      const azMin = Math.min(...pts.map((p) => p[0]));
      // The block behind the walker wraps the compass and hides nothing ahead.
      if (Math.max(...pts.map((p) => p[0])) - azMin > 90) continue;
      hulls.push(hullOf(pts));
    }
    return { eye, hulls };
  });
  return (dir) => {
    let seen = 0;
    for (const { eye, hulls } of eyes) {
      const px = WORLD.eye[0] + SPRITE_DISTANCE * dir[0] - eye[0];
      const py = WORLD.eye[1] + SPRITE_DISTANCE * dir[1] - eye[1];
      const pz = WORLD.eye[2] + SPRITE_DISTANCE * dir[2] - eye[2];
      const at = [Math.atan2(px, -pz) / DEG, Math.atan2(py, Math.hypot(px, pz)) / DEG];
      if (!hulls.some((hull) => depthIn(hull, at) >= 0)) seen++;
    }
    return seen / eyes.length;
  };
}

// What a piece in a hole may be scaled to. The library is written at a little
// over half the reference's own rate because it is laid down enlarged; a hole is
// the one place it is laid down SMALL, and a piece minified is a piece the
// sampler has mip levels for.
// The ceiling is the free sky's own: planPlacements lays these same pieces at
// one to two and six tenths of the size they were cut, so a piece behind a block
// at two and a half is a piece at a size the walker meets it at anyway. What
// actually decides the size here is the block, which is nine degrees wide.
const HOLE_SCALE = { min: 0.40, max: 2.60, step: 0.025 };

// And how far it may be turned. Small, and for a reason that is arithmetic
// rather than taste: a rolled rectangle is wider in bearing than an upright one
// by its own height times the sine, and height is what these pieces have.
const HOLE_ROLLS = [0, 7, -7];

/**
 * Which holes stand in weather, and what sky each of them has.
 *
 * The ring reading above, plus the span of the hole that is sky rather than
 * land, which is where a piece may be put.
 */
function readHoles(material) {
  const { stone, ground, cutAlpha } = material;
  const project = makeProjector();
  const sight = walkSight();
  const out = [];
  for (const shape of OUTLINES) {
    let ring = 0;
    let ringN = 0;
    let elLow = 90;
    let elHigh = -90;
    let sky = 0;
    for (let el = shape.elMin - HOLE_RING_DEG; el <= shape.elMax + HOLE_RING_DEG; el += 0.1) {
      for (let az = shape.azMin - HOLE_RING_DEG; az <= shape.azMax + HOLE_RING_DEG; az += 0.1) {
        const px = project(directionOf(az, el));
        if (!px) continue;
        const x = Math.round(px[0]);
        const y = Math.round(px[1]);
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        const o = y * W + x;
        const depth = depthIn(shape.hull, [az, el]);
        if (depth >= 0) {
          // Inside the block: how much of it is sky the photograph lost, rather
          // than land it never had.
          if (stone[o] && !ground[o]) {
            sky++;
            elLow = Math.min(elLow, el);
            elHigh = Math.max(elHigh, el);
          }
          continue;
        }
        if (depth < -HOLE_RING_DEG) continue;
        if (stone[o] || ground[o]) continue;
        ring += cutAlpha[o];
        ringN++;
      }
    }
    out.push({
      ...shape,
      weather: ringN ? ring / ringN : 0,
      elLow: sky ? elLow : shape.elMin,
      elHigh: sky ? elHigh : shape.elMax,
      sky,
    });
    const hole = out[out.length - 1];
    // AND WHAT THE PHOTOGRAPH CARRIES ACROSS THE NEAREST RIM, point by point.
    //
    // The reading that decides where a piece goes. A bite reads where the bank
    // it was taken out of is DENSE right up against the block: cloud, a straight
    // edge, sky. Where the block stands against sky already, nothing reads and
    // nothing needs putting there. So every direction inside the outline is
    // asked one question — what is on the other side of the nearest edge — and
    // the piece is laid where the answers are largest, which is where the bank
    // is trying to carry on through.
    const g = { az0: shape.azMin, el0: shape.elMin, step: 0.2 };
    g.cols = Math.ceil((shape.azMax - shape.azMin) / g.step) + 1;
    g.rows = Math.ceil((shape.elMax - shape.elMin) / g.step) + 1;
    g.data = new Float32Array(g.cols * g.rows);
    // The bite itself, cell by cell: sky the photograph lost, and how far inside
    // the outline it stands. What is laid in the hole is read back against these
    // two — how much of the bite carries cloud again, and how wide the rim of
    // bare sky the clearance leaves round it is.
    g.sky = new Uint8Array(g.cols * g.rows);
    g.depth = new Float32Array(g.cols * g.rows);
    // And what is standing there so far, which is what makes a second piece in
    // one hole worth what it adds rather than what it covers.
    g.filled = new Float32Array(g.cols * g.rows);
    for (let j = 0; j < g.rows; j++) {
      for (let i = 0; i < g.cols; i++) {
        const az = g.az0 + i * g.step;
        const el = g.el0 + j * g.step;
        const depth = depthIn(shape.hull, [az, el]);
        if (depth < 0) continue;
        {
          const px = project(directionOf(az, el));
          if (px) {
            const x = Math.round(px[0]);
            const y = Math.round(px[1]);
            if (x >= 0 && x < W && y >= 0 && y < H) {
              const o = y * W + x;
              if (stone[o] && !ground[o]) {
                g.sky[j * g.cols + i] = 1;
                g.depth[j * g.cols + i] = depth;
              }
            }
          }
        }
        // Weighted only where the bite is: a cell of the outline that stands on
        // the land the photograph does show is not sky anybody lost, and
        // carrying cloud there is not what this is for.
        if (!g.sky[j * g.cols + i]) continue;
        if (el < hole.elLow || el > hole.elHigh) continue;
        // EVERY CELL OF THE BITE IS WORTH SOMETHING, and the ones the bank runs
        // into are worth more.
        //
        // The rim reading alone was what the unit before this one chose ONE
        // piece by, and as a rule for choosing several it stops after two: the
        // dense rim is a tenth of a bite a hundred and sixteen square degrees
        // across, so the third piece measured against it adds four hundredths of
        // what the first did and is refused, with two thirds of the hole still
        // bare. It is bare sky in the shape of a monolith that reads, wherever
        // in the bite it stands, so bare sky anywhere in the bite is worth a
        // piece — just not as much as bare sky against a bank.
        g.data[j * g.cols + i] = HOLE_BASE_WEIGHT;
        // The nearest edge of the outline, and a short step past it.
        let near = Infinity;
        let out2 = null;
        for (let k = 0; k < shape.hull.length; k++) {
          const a = shape.hull[k];
          const b = shape.hull[(k + 1) % shape.hull.length];
          const ex = b[0] - a[0];
          const ey = b[1] - a[1];
          const len = Math.hypot(ex, ey) || 1;
          const d = (-ey * (az - a[0]) + ex * (el - a[1])) / len;
          if (d >= near) continue;
          near = d;
          out2 = [az - (ey / len) * (d + HOLE_RING_DEG / 2),
            el + (ex / len) * (d + HOLE_RING_DEG / 2)];
        }
        if (!out2) continue;
        const px = project(directionOf(out2[0], out2[1]));
        if (!px) continue;
        const x = Math.round(px[0]);
        const y = Math.round(px[1]);
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        const o = y * W + x;
        if (stone[o] || ground[o]) continue;
        g.data[j * g.cols + i] += cutAlpha[o];
      }
    }
    // AND WHAT THE WALK CAN SEE IS WORTH MORE THAN WHAT IT CANNOT.
    g.seen = new Float32Array(g.cols * g.rows);
    for (let j = 0; j < g.rows; j++) {
      for (let i = 0; i < g.cols; i++) {
        const k = j * g.cols + i;
        if (!g.sky[k]) continue;
        g.seen[k] = sight(directionOf(g.az0 + i * g.step, g.el0 + j * g.step));
        g.data[k] *= HOLE_UNSEEN + (1 - HOLE_UNSEEN) * g.seen[k];
      }
    }
    // AND THE RIM IS WORTH MORE THAN THE MIDDLE.
    //
    // What draws a block is not the bare sky in the middle of the bite, it is
    // the bare sky along its EDGE: from six or twelve metres to the side the
    // block has swung off most of the patch it was hiding, and what the walker
    // then sees is the photograph's own weather, a line of clear sky, and
    // whatever stands inside. The line is the shape. Half a degree of it is owed
    // — that is the clearance, and it is not negotiable — but everything from
    // there out to a degree and a half is the piece's own matte giving the edge
    // away, and a piece pushed against the rim gives away less of it.
    for (let k = 0; k < g.data.length; k++) {
      if (!g.sky[k]) continue;
      g.data[k] *= 1 + 1.2 * smoothstep(2.0, 0.5, g.depth[k]);
    }
    hole.grid = g;
    // The cells, once, as directions: the search below reads them a few hundred
    // thousand times and computing a unit vector from two angles inside that
    // loop is most of the bake.
    hole.cells = [];
    for (let j = 0; j < g.rows; j++) {
      for (let i = 0; i < g.cols; i++) {
        const k = j * g.cols + i;
        if (!g.sky[k]) continue;
        hole.cells.push({
          k,
          weight: g.data[k],
          dir: directionOf(g.az0 + i * g.step, g.el0 + j * g.step),
        });
      }
    }
    hole.skyCells = hole.cells;
    hole.joins = (az, el) => {
      const i = Math.round((az - g.az0) / g.step);
      const j = Math.round((el - g.el0) / g.step);
      if (i < 0 || i >= g.cols || j < 0 || j >= g.rows) return 0;
      return g.data[j * g.cols + i];
    };
  }
  return out;
}

/**
 * How much of the bite a placement actually puts cloud back into.
 *
 * Read on the piece's own COVERAGE laid over the hole's own sky, and weighted
 * by what the photograph carries just across the nearest rim — which is the
 * whole of what the eye is judging. A window is not a cloud: these pieces fill
 * two thirds to nine tenths of their envelope and a good deal less of their
 * rectangle, so a placement chosen on its window is a placement chosen on its
 * empty corners. And a cloud hung where the block already stood against sky
 * closes nothing: the bite is where the bank runs into the stone, and the
 * weight is what puts the piece there.
 */
function holeScore(stand, hole, { commit = false } = {}) {
  const { tile } = stand;
  const halfU = tile.halfU * stand.scale;
  const halfV = tile.halfV * stand.scale;
  const { c, right, up } = tileBasis(stand.azimuth, stand.elevation);
  const roll = (stand.roll || 0) * DEG;
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const { filled } = hole.grid;
  let score = 0;
  // Scored on the cells the bank runs into, written over the whole of the bite:
  // what the next piece is worth is about the weather round the block, and what
  // this hole now carries is about all of it.
  for (const cell of (commit ? hole.skyCells : hole.cells)) {
    // WHAT IS ALREADY THERE IS NOT LAID TWICE.
    //
    // A hole nine degrees across and fourteen tall is not one cloud, and the
    // unit before this one could only ask which single piece covered most of
    // it. Asked that question twice the answer is the same piece twice, in the
    // same place, which adds nothing at all. So a piece is worth WHAT IT ADDS
    // to what the hole already carries — and the two or three that follow the
    // first go where the first one is not, which is exactly the corner the rim
    // of bare sky was being left in.
    const have = filled[cell.k];
    if (have >= 0.995) continue;
    const d = cell.dir;
    // The tangent plane of the tile's own centre, which is the projection the
    // quad is: where along its two axes this direction lands.
    const w = d[0] * c[0] + d[1] * c[1] + d[2] * c[2];
    if (w <= 1e-3) continue;
    const hx = d[0] / w - c[0];
    const hy = d[1] / w - c[1];
    const hz = d[2] / w - c[2];
    const u = (hx * right[0] + hy * right[1] + hz * right[2]) / halfU;
    const v = (hx * up[0] + hy * up[1] + hz * up[2]) / halfV;
    const su = (u * cr + v * sr) * stand.flip;
    const t = -u * sr + v * cr;
    if (su < -1 || su > 1 || t < -1 || t > 1) continue;
    const i = Math.min(tile.width - 1, Math.max(0, Math.floor((su + 1) / 2 * tile.width)));
    const j = Math.min(tile.height - 1, Math.max(0, Math.floor((1 - t) / 2 * tile.height)));
    // Two coverages over one another leave what one over the other leaves,
    // which is the arithmetic the frame itself composites them by.
    const now = 1 - (1 - have) * (1 - Math.min(1, tile.a[j * tile.width + i]));
    // And what it is worth is what it brings across the level the frame can
    // show, not the coverage it adds.
    score += (reads(now) - reads(have)) * cell.weight;
    if (commit) filled[cell.k] = now;
  }
  return score * hole.grid.step * hole.grid.step;
}

// HOW MANY PIECES ONE HOLE MAY BE GIVEN.
//
// One was never enough and the arithmetic says so plainly. The first block hides
// nine and a half degrees of bearing by nine of height; the biggest piece that
// stays inside it with the clearance it owes is eight by nine, and a piece is
// matted radially, so what actually carries cloud is an ellipse inside that. One
// piece therefore leaves a crescent of bare sky all the way round — and a
// crescent round a rectangle is the rectangle, which is the shape the unit
// before this one was failed for.
//
// Two or three pieces that OVERLAP have no such envelope. Each of them keeps the
// clearance on its own account, so the invariant is untouched; between them they
// reach into the corners the first one's matte gave away, and what is left is
// the clearance itself and nothing more.
const HOLE_PIECES = 6;

// And when the next one is not worth laying: a piece that adds less than this
// share of what the first one added is a piece standing where cloud already
// stands, and every piece costs a draw of the atlas and a quad in the frame.
const HOLE_GAIN_FLOOR = 0.06;

/**
 * What stands in each hole worth filling.
 *
 * The pieces of the library that fit, laid where the bank the block bit into is
 * trying to carry on through, each of them worth what it ADDS to what the ones
 * before it left. What has to stop reading as a block is the WIDTH of the gap —
 * a piece that leaves a broad band of sky either side of it has put a cloud in
 * front of a monolith — and a piece that adds most is the piece that closes most
 * of that width, so the two are one question asked once.
 */
function planHoleFillers(tiles, holes, material, used, standing = []) {
  const library = tiles.filter((t) => t.kind === 'library'
    && t.halfV / t.halfU < 1.8 && t.halfU / t.halfV < 1.8
    && t.silhouette.areaRatio <= MAX_COVER_SHARE);
  const capOf = (tile) => (tile.distinct ? 1 : 2);
  const placed = [];
  const already = () => [...standing, ...placed];
  const wanted = holes.filter((h) => h.weather >= HOLE_WEATHER && h.sky > 0)
    .sort((a, b) => b.weather - a.weather);
  log(`  the library holds ${library.length} piece(s) a hole may use — square enough to `
    + `turn and with a cover that is not its own window — of the `
    + `${tiles.filter((t) => t.kind === 'library').length} it cut, and between them they have `
    + `${library.reduce((t, s) => t + Math.max(0, capOf(s) - (used.get(s.id) || 0)), 0)} turn(s) `
    + 'still unspent');
  // A TURN EACH, and not a hole at a time.
  //
  // Read hole by hole, the first block gets what the fourth left, and what the
  // fourth leaves is nothing: it is fourteen degrees tall against nine, it takes
  // five pieces before it stops paying, and this photograph does not hold ten
  // pieces of library a hole can use. Measured that way round the fourth came
  // out at 47 per cent of its bite carrying cloud and the first at 29 — and the
  // first is the one the client's own eye stopped on, because it is the one the
  // weather frames. Dealt a turn each they finish level, which is what the
  // reader of the panorama is going to see.
  const board = wanted.map((hole) => ({ hole, laid: [], first: 0, done: false }));
  for (let round = 0; round < HOLE_PIECES; round++) {
    for (const seat of board) {
      if (seat.done) continue;
      fillOnce(seat, round);
    }
  }
  for (const seat of board) reportHole(seat.hole, seat.laid);
  return placed;

  function fillOnce(seat, round) {
    const { hole, laid } = seat;
    // Where a piece of this size and turn may have its CENTRE, which is the
    // block's own box eroded by half the piece and by what the piece owes the
    // edge. The outline is convex and inside that box, so nothing outside this
    // rectangle can be inside the outline; a piece too big for the block has an
    // empty rectangle and costs nothing at all to reject, which is what keeps a
    // search over four pieces, two holes and thirty five pieces of library
    // inside the minute the bake had.
    const region = (spanU, spanV, roll, margin) => {
      const cos = Math.abs(Math.cos(roll * DEG));
      const sin = Math.abs(Math.sin(roll * DEG));
      const halfAz = (spanU * cos + spanV * sin) / 2 + margin;
      const halfEl = (spanV * cos + spanU * sin) / 2 + margin;
      return {
        az0: hole.azMin + halfAz,
        az1: hole.azMax - halfAz,
        el0: Math.max(hole.elLow, hole.elMin + halfEl),
        el1: Math.min(hole.elHigh, hole.elMax - halfEl),
      };
    };
    {
      let chosen = null;
      let chosenScore = 0;
      // WHAT ADDS MOST, and not simply what is biggest.
      //
      // The unit before this one took the largest piece that fitted, which is
      // the right question when there is one piece and the wrong one when there
      // are four: the second piece's whole job is the sky the first one left,
      // and a piece is worth that and nothing else. Largest still comes into it,
      // because a large piece covers more of the bite and therefore adds more —
      // it is now the answer rather than the question.
      for (const tile of library) {
        if ((used.get(tile.id) || 0) >= capOf(tile)) continue;
        let best = null;
        for (let scale = HOLE_SCALE.max; scale >= HOLE_SCALE.min - 1e-9; scale -= HOLE_SCALE.step) {
          const spanU = 2 * Math.atan(tile.halfU * scale) / DEG;
          const spanV = 2 * Math.atan(tile.halfV * scale) / DEG;
          const margin = holeMargin({ tile, scale });
          for (const roll of HOLE_ROLLS) {
            const box = region(spanU, spanV, roll, margin);
            if (box.az1 < box.az0 || box.el1 < box.el0) continue;
            for (const flip of [1, -1]) {
              const at = (az, el) => {
                const stand = {
                  id: `${tile.id}@${hole.id}`,
                  tile,
                  hole: hole.id,
                  azimuth: az,
                  elevation: el,
                  scale,
                  roll,
                  flip,
                  arc: HOLE_ARC_DEG,
                  distance: SPRITE_DISTANCE,
                };
                const score = holeScore(stand, hole);
                if (best && score <= best.score) return;
                if (already().some((p) => p.tile === tile && twins(p, stand))) return;
                if (checkHoleCover([stand], material).length) return;
                best = { stand, score };
              };
              for (let el = box.el1; el >= box.el0 - 1e-9; el -= 0.5) {
                for (let az = box.az0; az <= box.az1 + 1e-9; az += 0.5) at(az, el);
              }
              // And the middle of the band as well, which for a piece that only
              // just fits IS the band: a step of half a degree over a rectangle
              // a tenth of a degree wide never lands inside it.
              at((box.az0 + box.az1) / 2, (box.el0 + box.el1) / 2);
            }
          }
          // The largest size this piece can be laid at is the one it is laid at:
          // below it the same cloud covers less of the same bite.
          if (best) break;
        }
        if (best) {
          // Finely, round wherever the sweep found it.
          const { azimuth, elevation, roll, flip, scale } = best.stand;
          const { tile: t } = best.stand;
          for (let el = elevation - 0.5; el <= elevation + 0.5 + 1e-9; el += 0.25) {
            for (let az = azimuth - 0.5; az <= azimuth + 0.5 + 1e-9; az += 0.25) {
              const stand = {
                id: `${t.id}@${hole.id}`,
                tile: t,
                hole: hole.id,
                azimuth: az,
                elevation: el,
                scale,
                roll,
                flip,
                arc: HOLE_ARC_DEG,
                distance: SPRITE_DISTANCE,
              };
              const score = holeScore(stand, hole);
              if (score <= best.score) continue;
              if (already().some((p) => p.tile === t && twins(p, stand))) continue;
              if (checkHoleCover([stand], material).length) continue;
              best = { stand, score };
            }
          }
          if (!chosen || best.score > chosenScore) {
            chosen = best.stand;
            chosenScore = best.score;
          }
        }
      }
      if (!chosen) {
        seat.done = true;
        const spare = library.filter((t) => (used.get(t.id) || 0) < capOf(t));
        if (round > 0) {
          log(`  block ${hole.id}: ${laid.length} piece(s) stand there and no `
            + `${laid.length + 1}th can: of the ${spare.length} piece(s) the library still has `
            + `spare (${spare.map((t) => `${t.id} ${(2 * Math.atan(t.halfU) / DEG).toFixed(1)}x`
              + `${(2 * Math.atan(t.halfV) / DEG).toFixed(1)}`).join(' ') || 'none'}), none `
            + 'stays inside the outline with the clearance it owes at any size');
          return;
        }
        log(`  block ${hole.id}: NOTHING IS LAID. The photograph carries `
          + `${hole.weather.toFixed(3)} of coverage round it, so the hole reads; but `
          + (spare.length
            ? `no piece of the ${spare.length} this library still has spare (${spare
              .map((t) => t.id).join(' ')}) stays inside the outline with the clearance it owes `
              + 'at any size it may be laid at'
            : 'this library has no piece left to lay: every one of them is already standing as '
              + 'often as the distinctness rule allows, and a hole is not a reason to let a '
              + 'cloud stand twice')
          + '. A gap of sky is better than a piece that shows past the stone, so it keeps its gap');
        return;
      }
      if (round === 0) seat.first = chosenScore;
      else if (chosenScore < seat.first * HOLE_GAIN_FLOOR) {
        seat.done = true;
        log(`  block ${hole.id}: a further piece (${chosen.tile.id}) would add `
          + `${chosenScore.toFixed(2)} sq deg of coverage against the `
          + `${seat.first.toFixed(2)} the first one added, which is under the `
          + `${HOLE_GAIN_FLOOR} share worth a quad, so ${laid.length} stand there`);
        return;
      }
      // What it adds is now what the hole carries, so the next piece is worth
      // the sky this one left rather than the sky it covered.
      holeScore(chosen, hole, { commit: true });
      // The development handle is spent HERE, on the piece the plan has already
      // settled on, and not on the candidates: applied during the search it is no
      // handle at all, because the search simply answers with a smaller piece.
      // Spent afterwards, what ships is a piece too big for its block, and the
      // invariant is put in front of it.
      chosen.scale *= HOLE_GROW;
      placed.push(chosen);
      laid.push(chosen);
      used.set(chosen.tile.id, (used.get(chosen.tile.id) || 0) + 1);
    }
  }
}

/**
 * What a hole carries once its pieces are in it, and how wide the bare rim is.
 *
 * Read on the bite itself — the cells of the outline where the photograph lost
 * sky — rather than on the block's bounding box, and split by how far inside the
 * outline each cell stands, because the clearance is owed at the edge and owed
 * nowhere else. A hole that reads as a shape is one whose rim is bare all the
 * way round; a hole whose rim is bare only where the clearance is has nothing
 * left to give.
 */
function reportHole(hole, laid) {
  const g = hole.grid;
  const bands = [[0, 0.6], [0.6, 1.5], [1.5, 99]];
  const rows = bands.map(() => ({ n: 0, live: 0 }));
  let total = 0;
  let cover = 0;
  let live = 0;
  // And the same three readings over the part of the bite the walk can see,
  // which is the part the notch is made of.
  let open = 0;
  let openCover = 0;
  let openLive = 0;
  for (let k = 0; k < g.sky.length; k++) {
    if (!g.sky[k]) continue;
    // Counted where the frame can SHOW it, which is a twentieth of coverage and
    // not the floor of the arithmetic: read on the floor, a plan that washes the
    // whole bite scores better than one that puts a cloud in it, and the frame
    // says the opposite.
    const live1 = g.filled[k] >= HOLE_READS[0];
    total++;
    cover += g.filled[k];
    if (live1) live++;
    if (g.seen[k] > 0) {
      open++;
      openCover += g.filled[k];
      if (live1) openLive++;
      const row = rows[bands.findIndex(([lo, hi]) => g.depth[k] >= lo && g.depth[k] < hi)];
      row.n++;
      if (live1) row.live++;
    }
  }
  if (!total) return;
  log(`  block ${hole.id}: ${laid.length} piece(s) — ${laid.map((p) => `${p.tile.id} at `
    + `az ${p.azimuth.toFixed(2)} el ${p.elevation.toFixed(2)} scale `
    + `${p.scale.toFixed(2)} (${(2 * Math.atan(p.tile.halfU * p.scale) / DEG).toFixed(1)}x`
    + `${(2 * Math.atan(p.tile.halfV * p.scale) / DEG).toFixed(1)} deg)`).join('; ') || 'none'}`);
  log(`    the bite is ${(total * g.step * g.step).toFixed(1)} sq deg of lost sky, of which `
    + `${(open * g.step * g.step).toFixed(1)} is seen from somewhere on the walk; `
    + `${(100 * live / total).toFixed(1)}% of the bite and `
    + `${open ? (100 * openLive / open).toFixed(1) : '--'}% of what is seen carries cloud `
    + `again, at ${(cover / total).toFixed(3)} and `
    + `${open ? (openCover / open).toFixed(3) : '--'} of coverage on average`);
  log(`    what is seen, by distance inside the outline: ${bands.map(([lo, hi], k) => `${lo
    .toFixed(1)}-${hi > 90 ? 'in' : hi.toFixed(1)} deg ${rows[k].n
    ? `${(100 * rows[k].live / rows[k].n).toFixed(0)}%` : '--'}`).join(', ')} `
    + `(the clearance alone is ${HOLE_CLEARANCE_DEG.toFixed(2)} deg wide)`);
}

/**
 * Where the library stands, across the two hundred and eighty seven degrees the
 * photograph never showed.
 *
 * Not evenly, and not in pairs. A sky with its banks at equal intervals is as
 * much of a machine as a sky with its blobs at equal intervals, so the bearing
 * walks by a large irrational step and is then knocked sideways by up to a third
 * of a gap; and no piece is ever laid at the mirror of another piece's bearing,
 * because two of the same cloud either side of a line is the one arrangement a
 * sky never makes and an eye always finds.
 *
 * Height comes from the reference's own coverage against height, weighted by the
 * cosine so a band near the horizon is not given the sky of a band overhead.
 * Size, roll and mirroring are drawn from the same stream; what is delivered is
 * measured against what was wanted and printed rather than assumed.
 */
function planPlacements(tiles, bands, used = new Map(), standing = [], seed = 0x5c1e) {
  let state = seed >>> 0;
  const random = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
  // Only the library. A mass is matted by the rectangle it was pushed out to,
  // which is right where it stands and wrong anywhere else; the library carries
  // a matte of its own.
  // A piece two and a half times as tall as it is wide is a spire, and a spire
  // is the most recognisable thing a sky can contain: rolled and mirrored it is
  // still a spire, and one panorama had the same one at five bearings.
  // Nor a piece whose cover kept every cell it was offered: that is the window
  // again, and the selection above cannot see it because the cover is fitted
  // after the matte.
  // Nor the reserve, which exists only to be laid behind a block: it was chosen
  // after this pool was closed precisely so that this plan reads the pool it
  // always read and deals the same twenty seven bearings.
  const library = tiles.filter((t) => t.kind === 'library' && !t.holesOnly
    && t.halfV / t.halfU < 1.8 && t.halfU / t.halfV < 1.8
    && t.silhouette.areaRatio <= MAX_COVER_SHARE);
  if (!library.length) return [];
  // And no piece may stand more often than the pool can share the sky out —
  // nor, if it is a whole cloud with a shape of its own, more than once at all.
  // A whole cloud once; anything else twice, which is what the anti-twin rule
  // was already assuming when it reasoned about twenty seven over fourteen and
  // is now stated rather than arrived at.
  // The count comes in already carrying whatever the holes took: a piece behind
  // a block is still a piece of this library, and the cap is about how often the
  // walker can meet it, not about which side of a monolith it stands on.
  const capOf = (tile) => (tile.distinct ? 1 : 2);

  const total = bands.reduce((t, b) => t + b.cover * Math.cos(b.elevation * DEG), 0);
  const drawElevation = () => {
    let u = random() * total;
    for (const b of bands) {
      u -= b.cover * Math.cos(b.elevation * DEG);
      if (u <= 0) return b.elevation + (random() * 2 - 1) * 2;
    }
    return bands[bands.length - 1].elevation;
  };

  const placed = [];
  let bearing = SECTOR[1] + 20 + random() * 40;
  const wrap = (a) => ((a + 180) % 360 + 360) % 360 - 180;
  for (let k = 0; placed.length < PLACEMENTS && k < PLACEMENTS * 40; k++) {
    bearing += 137.507 + (random() * 2 - 1) * 22;
    const azimuth = wrap(bearing);
    // Never inside the photograph's own sector: the masses are the truth there.
    if (azimuth > SECTOR[0] - 6 && azimuth < SECTOR[1] + 6) continue;
    // Nor the same piece at the mirror of where that piece already stands: two
    // of one cloud either side of a line is the one arrangement a sky never
    // makes and an eye always finds. Different pieces facing each other are not
    // a mirror of anything, and forbidding those as well empties the sky —
    // fourteen degrees excluded per placement is most of a turn.
    const elevation = drawElevation();
    const tile = library[Math.floor(random() * library.length)];
    if ((used.get(tile.id) || 0) >= capOf(tile)) continue;
    if (placed.some((p) => p.tile === tile && Math.abs(wrap(-p.azimuth - azimuth)) < 12)) continue;
    const scale = 1.0 + random() ** 1.25 * 1.6;
    const roll = (random() * 2 - 1) * 26;
    const flip = random() < 0.5 ? -1 : 1;
    const spread = Math.atan(tile.halfU * scale) / DEG;
    // And not on top of a neighbour: two banks at one bearing are one bank.
    if (placed.some((p) => Math.abs(wrap(p.azimuth - azimuth))
      < (spread + Math.atan(p.tile.halfU * p.scale) / DEG) * 0.55
      && Math.abs(p.elevation - elevation) < 6)) continue;
    const stand = {
      id: `${tile.id}@${azimuth.toFixed(0)}`,
      tile,
      azimuth,
      elevation,
      scale,
      roll,
      flip,
      // Depth is what settles the order they are drawn in, and a piece low in
      // the sky is further away than a piece high in it.
      distance: SPRITE_DISTANCE,
    };
    // Nor twice in one frame: the same piece inside one field of view is the
    // same piece, and inside two it is the same piece unless it has been turned
    // over or turned round. The pieces already standing behind the blocks count
    // here — a walker two steps to the side has one of those on the screen.
    if ([...standing, ...placed].some((p) => p.tile === tile && twins(p, stand))) continue;
    // Nor reaching into the sector, which is a different question from standing
    // in it: a piece whose centre is eight degrees clear of the frame still puts
    // its own corner in the frame's corner once it is two and a half times its
    // cut size and the drift has turned the field seven degrees.
    if (checkPoseFootprint([stand]).length) continue;
    placed.push(stand);
    used.set(tile.id, (used.get(tile.id) || 0) + 1);
  }
  return placed;
}

// ------------------------------------------------------------------ the atlas

/**
 * Skyline packing, widest first.
 *
 * Shelves were tried and are what a picture like this is worst for: two tiles
 * six hundred texels tall and eleven a fifth of that, and a shelf holds the
 * short ones at the height of the tall one. This keeps a profile of the used
 * height across the atlas and drops each tile at the lowest place it fits, which
 * on this set is the difference between not fitting and two thirds full.
 */
function packAtlas(tiles) {
  const skyline = new Int32Array(ATLAS.width).fill(GUTTER);
  const order = [...tiles].sort((a, b) => (b.width * b.height) - (a.width * a.height));
  for (const tile of order) {
    const span = tile.width + GUTTER;
    let bestX = -1;
    let bestY = Infinity;
    // ON THE TRANSCODER'S OWN GRID, and that is not a detail.
    //
    // What ships is not this image, it is a UASTC transcode of it, and UASTC
    // codes four texels by four independently. A tile whose left edge falls at
    // an odd column shares its first block column with whatever is beside it, so
    // the same texels packed at a different offset come back DIFFERENT — which
    // is how eleven pieces added behind two monoliths moved eleven per cent of
    // the sky at the reference pose by a level, with the composition and the
    // level scale both untouched. Every tile is cut to a multiple of four
    // texels, the gutter is eight, and the rows already land on fours; this puts
    // the columns there too, and then a tile's blocks hold that tile and
    // nothing else, wherever the packer decides to put it.
    for (let x = 0; x + span <= ATLAS.width; x += 4) {
      let y = 0;
      for (let k = 0; k < span; k++) y = Math.max(y, skyline[x + k]);
      if (y < bestY) { bestY = y; bestX = x; }
    }
    if (bestX < 0 || bestY + tile.height + GUTTER > ATLAS.height) {
      throw new Error(`atlas full: ${tile.id} (${tile.width}x${tile.height}) does not fit`);
    }
    tile.rect = { x: bestX, y: bestY, width: tile.width, height: tile.height };
    for (let k = 0; k < span; k++) skyline[bestX + k] = bestY + tile.height + GUTTER;
  }
  const used = tiles.reduce((t, s) => t + s.width * s.height, 0);
  return {
    used,
    occupancy: used / (ATLAS.width * ATLAS.height),
    bottom: Math.max(...skyline),
  };
}

// ------------------------------------------------------ the sky the water sees

// The weather, again, as one equirect picture.
//
// The water and the stone reflect the sky, and until now what they reflected
// was the dome — which carries no cloud, because the cloud is drawn as bodies
// standing in front of it. So the reference's own reflections, which show the
// bank lying in the run and on the lake, had nothing to show. Reading the
// sprites per reflected ray is not available at any price: it is thirty five
// quads to intersect per fragment, and the fragments in question are the whole
// meadow.
//
// So the same composition is laid down once, here, into a picture indexed by
// direction, and every reflecting surface reads it with the one tap it already
// takes for the sky. Coarse on purpose: a hundredth of the sprites' texel rate,
// because a rippled surface a few pixels wide does not resolve a cauliflower,
// and because the whole point is that it costs a tap and a third of a megabyte.
//
// It is the SAME composition and not a likeness of one: the same tiles, the same
// placements, the same order back to front, the same relighting, the same
// silhouette cells, and premultiplied against the same level scale, so that a
// surface compositing it over the dome arrives where a surface looking at the
// sprites would.
const EQUIRECT = { width: 1024, height: 512 };

// Samples per texel, per axis. A texel here is a third of a degree and a texel
// of the hero is a twentieth: read at one sample the picture would be the
// sprites aliased, and aliasing in a reflection reads as a shimmer when the eye
// turns.
const EQUIRECT_SAMPLES = 3;

/** Bilinear read of a tile's coverage and premultiplied colour. */
function readTile(tile, fi, fj, out) {
  const x = Math.min(tile.width - 1.001, Math.max(0, fi - 0.5));
  const y = Math.min(tile.height - 1.001, Math.max(0, fj - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const w = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  const o = [y0 * tile.width + x0, y0 * tile.width + x0 + 1,
    (y0 + 1) * tile.width + x0, (y0 + 1) * tile.width + x0 + 1];
  let a = 0;
  out[0] = 0; out[1] = 0; out[2] = 0;
  for (let k = 0; k < 4; k++) {
    a += tile.a[o[k]] * w[k];
    for (let c = 0; c < 3; c++) out[c] += tile.rgb[o[k] * 3 + c] * w[k];
  }
  return a;
}

/**
 * The composition, laid down over the sphere.
 *
 * @param {Array} field  the sprites, far first, exactly as the frame orders them
 * @returns {{data: Float32Array, covered: number}} premultiplied colour and coverage
 */
function bakeEquirect(field, sun) {
  const { width: W2, height: H2 } = EQUIRECT;
  const sky = new Float32Array(W2 * H2 * 4);
  const colour = [0, 0, 0];
  const cell = [0, 0, 0, 0];
  const step = 1 / EQUIRECT_SAMPLES;

  for (const sprite of field) {
    const { tile } = sprite;
    const { c, right, up } = tileBasis(sprite.azimuth, sprite.elevation);
    const roll = (sprite.roll || 0) * DEG;
    const cosR = Math.cos(roll);
    const sinR = Math.sin(roll);
    const target = sprite.relit
      ? sunInLocalFrame(sprite.elevation, sprite.azimuth, sun) : tile.sunSource;
    // The coverage gradient per degree of sky, which is the unit the shading
    // was fitted in and the unit the shader states it in.
    const perDegree = 1 / (2 * tile.degPerTexel * (sprite.scale || 1));
    const { live, cols, rows } = tile.silhouette;

    // Which texels this sprite can possibly reach, from its own perimeter.
    let elLo = 90;
    let elHi = -90;
    let azSpan = 0;
    const dir = [0, 0, 0];
    const at = (s, t) => {
      const u = (s * cosR - t * sinR) * sprite.halfU;
      const v = (s * sinR + t * cosR) * sprite.halfV;
      for (let k = 0; k < 3; k++) dir[k] = c[k] + u * right[k] + v * up[k];
      const len = Math.hypot(dir[0], dir[1], dir[2]);
      return [
        Math.atan2(dir[0] / len, -dir[2] / len) / DEG,
        Math.asin(Math.max(-1, Math.min(1, dir[1] / len))) / DEG,
      ];
    };
    for (let k = 0; k <= 40; k++) {
      const f = -1 + 2 * (k / 40);
      for (const [s, t] of [[f, -1], [f, 1], [-1, f], [1, f]]) {
        const [az, el] = at(s, t);
        elLo = Math.min(elLo, el);
        elHi = Math.max(elHi, el);
        let d = az - sprite.azimuth;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        azSpan = Math.max(azSpan, Math.abs(d));
      }
    }
    // Rows from the elevation, columns from the bearing, both with a texel of
    // margin so a partly covered edge texel is never dropped.
    const rowOf = (el) => (0.5 - el / 180) * H2;
    const jLo = Math.max(0, Math.floor(rowOf(elHi)) - 2);
    const jHi = Math.min(H2 - 1, Math.ceil(rowOf(elLo)) + 2);
    const iMid = (sprite.azimuth / 360 + 0.25) * W2;
    const iHalf = Math.ceil(azSpan / 360 * W2) + 2;

    for (let j = jLo; j <= jHi; j++) {
      for (let k = -iHalf; k <= iHalf; k++) {
        const i = ((Math.round(iMid) + k) % W2 + W2) % W2;
        let sa = 0;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let n = 0;
        for (let sj = 0; sj < EQUIRECT_SAMPLES; sj++) {
          for (let si = 0; si < EQUIRECT_SAMPLES; si++) {
            n++;
            // The equirect convention of core/sky.js, read backwards: the
            // bearing wraps from +X and north lands a quarter along.
            const uu = (i + (si + 0.5) * step) / W2;
            const vv = (j + (sj + 0.5) * step) / H2;
            const theta = (uu - 0.5) * 2 * Math.PI;
            const phi = (0.5 - vv) * Math.PI;
            const d = [
              Math.cos(phi) * Math.cos(theta), Math.sin(phi), Math.cos(phi) * Math.sin(theta),
            ];
            const w = d[0] * c[0] + d[1] * c[1] + d[2] * c[2];
            if (w <= 1e-3) continue;
            const U = (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / w / sprite.halfU;
            const V = (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / w / sprite.halfV;
            // Out of the roll and the mirror, back into the tile's own square.
            const s = U * cosR + V * sinR;
            const t = -U * sinR + V * cosR;
            const su = s * sprite.flip;
            if (su < -1 || su > 1 || t < -1 || t > 1) continue;
            // Only the cells the frame actually draws.
            const col = Math.min(cols - 1, Math.floor((su + 1) / 2 * cols));
            const row = Math.min(rows - 1, Math.floor((1 - t) / 2 * rows));
            if (!live[row * cols + col]) continue;
            const fi = (su + 1) / 2 * tile.width;
            const fj = (1 - t) / 2 * tile.height;
            const cover = readTile(tile, fi, fj, colour);
            if (cover <= 0) continue;
            if (sprite.relit) {
              const x0 = Math.min(tile.width - 2, Math.max(1, Math.round(fi - 0.5)));
              const y0 = Math.min(tile.height - 2, Math.max(1, Math.round(fj - 0.5)));
              const o = y0 * tile.width + x0;
              const gx = (tile.a[o + 1] - tile.a[o - 1]) * perDegree;
              const gy = (tile.a[o - tile.width] - tile.a[o + tile.width]) * perDegree;
              const tx = gx * sprite.flip;
              const ratio = shadeAt(tx * cosR - gy * sinR, tx * sinR + gy * cosR, cover, target)
                / Math.max(0.05, shadeAt(gx, gy, cover, tile.sunSource));
              for (let ch = 0; ch < 3; ch++) colour[ch] *= ratio;
            }
            sa += cover;
            sr += colour[0]; sg += colour[1]; sb += colour[2];
          }
        }
        if (sa <= 0) continue;
        cell[0] = sr / n; cell[1] = sg / n; cell[2] = sb / n; cell[3] = sa / n;
        // Premultiplied "over": this sprite is nearer than everything already
        // laid, which is what ordering the field far first means.
        const o = (j * W2 + i) * 4;
        const keep = 1 - cell[3];
        for (let ch = 0; ch < 3; ch++) sky[o + ch] = cell[ch] + sky[o + ch] * keep;
        sky[o + 3] = cell[3] + sky[o + 3] * keep;
      }
    }
  }

  let covered = 0;
  for (let i = 0; i < W2 * H2; i++) if (sky[i * 4 + 3] > 0.01) covered++;
  return { data: sky, covered: covered / (W2 * H2) };
}

// --------------------------------------------------------------- looking at it

/**
 * Each tile as the frame will show it: the material composited over the sky it
 * will stand against, through the same tone curve. Development only — this is
 * the picture the cut is judged on, and a cut judged on a coverage map is a cut
 * judged on the wrong thing.
 */
async function dumpTiles(tiles, material, dir) {
  mkdirSync(dir, { recursive: true });
  const clear = [0, 0, 0];
  for (const tile of tiles) {
    const { width, height, a, rgb } = tile;
    const out = Buffer.alloc(width * height * 3);
    const { c, right, up } = tileBasis(tile.azimuth, tile.elevation);
    for (let j = 0; j < height; j++) {
      const v = (1 - 2 * (j + 0.5) / height) * tile.halfV;
      for (let i = 0; i < width; i++) {
        const u = (2 * (i + 0.5) / width - 1) * tile.halfU;
        const d = [c[0] + u * right[0] + v * up[0], c[1] + u * right[1] + v * up[1],
          c[2] + u * right[2] + v * up[2]];
        const len = Math.hypot(d[0], d[1], d[2]);
        const elevation = Math.asin(Math.max(-1, Math.min(1, d[1] / len))) / DEG;
        const azimuth = Math.atan2(d[0] / len, -d[2] / len) / DEG;
        clearSkyAt(material.fit.params, material.fit.sun, elevation, azimuth, clear);
        const o = j * width + i;
        const display = agx([0, 1, 2].map((k) => rgb[o * 3 + k] + clear[k] * (1 - a[o])), 1);
        for (let k = 0; k < 3; k++) {
          out[o * 3 + k] = Math.max(0, Math.min(255,
            Math.round(linearToSrgb(display[k]) * 255)));
        }
      }
    }
    await writeCleanPng(out, { width, height, channels: 3 }, join(dir, `${tile.id}.png`));
    // And what the tile is made OF, which is the question every straight edge in
    // this sky turns out to be about: coverage, what the photograph measured,
    // and what had to be invented past its edge.
    const made = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      made[i * 3] = Math.round(Math.max(0, Math.min(1, a[i])) * 255);
      made[i * 3 + 1] = tile.invented[i] ? 0 : 255;
      made[i * 3 + 2] = tile.beyond[i] ? 255 : 0;
    }
    await writeCleanPng(made, { width, height, channels: 3 }, join(dir, `${tile.id}-made.png`));
  }
  log(`tiles written to ${dir}`);
}

// -------------------------------------------------------------------- the run

// The seeds, in pixels of the reference frame.
//
// The hero is cut in two, and where the two meet they OVERLAP by more than
// twice the fade — which is the whole reason the split is allowed at all.
// Two sprites carrying the same material, one fading out where the other is
// solid, composite back to that material exactly: premultiplied, a piece at
// coverage a laid over the same piece at coverage one returns colour C·a +
// C·(1−a) = C and coverage one. So a seam between overlapping pieces is not a
// seam. A seam between abutting pieces is a straight edge, and no fade makes it
// anything else.
//
// The masses are each pushed outwards until their own border stands in sky,
// which is what a window has to do when there is nothing to overlap it with.
const SEEDS = [
  { id: 'hero-west', kind: 'hero', box: [846, -76, 1352, 452], grow: 0 },
  { id: 'hero-east', kind: 'hero', box: [1146, -96, 1700, 430], grow: 0 },

  // The other masses the reference shows, at the bearings it shows them.
  //
  // Two of the map's eight are not here, and the reason is worth writing down:
  // read on colour alone, the map took the reference's own mountains for cloud.
  // Its mass six is the rock ridge at the right of the frame and its mass eight
  // the hills at the left — both grey green, both below the skyline this bake
  // finds, and both would have arrived in the sky as a green sprite.
  { id: 'mass-west-low', kind: 'mass', box: [0, 300, 190, 460], grow: 120 },
  { id: 'mass-west-mid', kind: 'mass', box: [396, 310, 516, 450], grow: 90 },
  { id: 'mass-west-high', kind: 'mass', box: [232, 152, 520, 340], grow: 90 },
  // The north tower has to be allowed to grow further than its neighbours, and
  // the reason is the third block. Its own weather carries on east behind that
  // block for the better part of two hundred pixels, so a window that may only
  // move a hundred and twenty ends its border in cloud whatever it does — inside
  // the block at the reference pose, where nothing shows it, and in open sky two
  // steps to either side, where it is a pale slab a fade band wide.
  { id: 'mass-north-tower', kind: 'mass', box: [600, 140, 748, 440], grow: 120 },

  // Two more of the map's masses are not here either, and this reason is
  // arithmetic rather than colour: their windows stood WHOLLY INSIDE another
  // window. The low piece under the north tower spanned four and a half degrees
  // of bearing inside the tower's nine, and the low piece by the fifth block
  // four inside the hero's thirty; both carried the same photograph as the
  // window over them, and both invented their own filling for the same hole
  // behind the same block. Sharing the material out between overlapping windows
  // makes the coverage exact where the material agrees, and two independent
  // inventions of one hole do not agree: measured in the map's own boxes, those
  // two masses were the last two out of tolerance, at 6 and 8 points over.
];

async function main() {
  const started = Date.now();
  mkdirSync(OUT_DIR, { recursive: true });
  const material = await readMaterial();

  const only = process.argv.find((v) => v.startsWith('--only='));
  const specs = [...SEEDS, ...findLibrary(material, {})]
    .filter((s) => !only || only.slice(7).split(',').includes(s.id));
  // Cut and completed first, and closed afterwards, because closing a mass has
  // to know where its neighbours' windows are: they carry the same material and
  // it has to be shared out between them rather than laid down twice.
  let tiles = [];
  for (const spec of specs) {
    const grown = growBox(spec.box, material, { limit: spec.grow ?? 0 });
    const tile = cutTile({ ...spec, box: grown.box }, material);
    tile.grown = grown.grown;
    completeTile(tile);
    tiles.push(tile);
  }
  const masses = tiles.filter((t) => t.kind !== 'library').map(windowOfTile);
  for (const tile of tiles) {
    closeWindow(tile, tile.kind === 'library' ? [] : masses, material.cloudCeiling);
    recordSun(tile, material.sun);
    tile.silhouette = fitSilhouette(tile);
    closeSilhouette(tile);
    // Degrees of sky one texel of this tile spans. Held on the tile rather than
    // only in the manifest, because the equirect below relights with it too and
    // the two readings must be one reading.
    tile.degPerTexel = 2 * Math.atan(tile.halfU) / DEG / tile.width;
  }
  // INVARIANT — the colour dies with the coverage.
  //
  // Read on the finished material, before the hold below can make it true: the
  // premultiplied value a texel carries, divided by the coverage it carries it
  // at, is the colour it is asking the frame to draw a cloud at. Over the
  // brightest cloud in the photograph, it is not a cloud — it is a piece of sky
  // that survived its own coverage, and the frame will draw it at full strength
  // over whatever dome it is laid on. That is the curtain, stated before any
  // sky is chosen, and it is the one number that separates this material from
  // the one the thirteenth gate bounced.
  const ceiling = material.cloudCeiling;
  const top = Math.max(...ceiling);
  // Failures the development handle asks to be CARRIED rather than thrown.
  //
  // This gate stands upstream of the two sky reading, and with the layer off it
  // is the first to fire — which hides the one it stands in front of. An
  // invariant is worth what it has been shown catching, and the two sky reading
  // is the one this session added, so with the handle off the fault is carried
  // past this gate, every reading downstream gets to state what it makes of the
  // same broken material, and the bake is failed here at the end whatever they
  // say. Nothing is written either way. A shipping run has the handle on and
  // never reaches this list.
  const carried = [];
  {
    const hold = holdToCoverage(tiles, ceiling, { clamp: SKY_LAYER });
    log(`the material as it ships: the brightest colour a texel asks of a cloud is `
      + `${hold.arrived.toFixed(2)} against a ceiling of `
      + `${ceiling.map((v) => v.toFixed(2)).join('/')} (${hold.arrivedAt}); the coverage the `
      + `atlas rounds to left ${hold.held} of ${hold.total} texels `
      + `(${(100 * hold.held / hold.total).toFixed(3)}%) to be held back to it`);
    if (hold.arrived > top * 1.001) {
      log(`  FAILED  ${hold.arrivedAt} asks for a cloud at ${hold.arrived.toFixed(2)}, `
        + `against the ${top.toFixed(2)} the brightest cloud in this photograph carries`);
      const fault = new Error('a texel of this material asks for a colour no cloud in the '
        + 'reference has: its colour did not die with its coverage, and every sky it is laid '
        + 'over will show the difference');
      if (SKY_LAYER) throw fault;
      carried.push(fault);
    }
  }
  // NO VEIL. It used to be cut here, last of all, because what it carried was
  // defined as whatever the weather had left the photograph still owed: the
  // reference's own sky, everywhere none of these bodies stands in front of it,
  // as a plate a hundred and twenty degrees wide hung in the dome.
  //
  // It was measured material in the dome, which is the one thing the dome may
  // not have. Read as a direction it is a tangent plane, so it has a rectangle
  // for a boundary and a vanishing line for a horizon, and it put both of them
  // in the sky: at high pitch the plate's own top edge was an arc of shoulders
  // across the zenith, and the diffuse departures it carried were the soft dark
  // patches the frame was failed for. Nothing about it could be fixed, because
  // what it is FOR is to carry one photograph's own sky onto a sphere, and one
  // photograph's sky has one photograph's edges.
  //
  // What replaces it is that the dome is now that sky's own model, drawn
  // everywhere and bounded nowhere. What is given up with it is stated in
  // src/core/sky.js: the reference's sector no longer matches texel for texel.
  //
  // Its four hundred and twenty eight by two hundred and sixteen texels go back
  // to the atlas, which is what lets the weather keep the cells it needs.

  {
    const cut = tiles.filter((t) => t.continuationDropped && t.continuationDropped.length);
    log(`continuation: ${cut.length} tile(s) drew a body past the photograph that stood on `
      + `nothing the photograph showed, and it was dissolved`);
    for (const tile of cut) {
      log(`  ${tile.id}: ${tile.continuationDropped.map((v) => `${v.texels} texels `
        + `(${v.sqdeg} sq deg, standing on ${v.footing} deg of the photograph, `
        + `filling ${v.fill} of its envelope)`).join('; ')}`);
    }
    const stranded = tiles.filter((t) => t.continuationStranded);
    log(`  and coverage held further than ${CONTINUATION_REACH_DEG} deg from any body, `
      + `which is a contour of the search's own field and not weather: `
      + `${stranded.length ? stranded.map((t) => `${t.id} ${t.continuationStranded} texels`).join(', ') : 'none'}`);
  }
  {
    // INVARIANT — every edge in this sky is a cloud's own edge.
    const cuts = checkStraightCuts(tiles);
    for (const line of cuts) log(`  FAILED  ${line}`);
    if (cuts.length) throw new Error(`${cuts.length} tile(s) end in a ruled line`);
    log(`edges: worst coverage standing on any cut of any tile `
      + `${Math.max(...tiles.map((t) => t.edgeAlpha)).toFixed(4)}, `
      + `against ${CELL_LIVE.toFixed(4)} allowed`);
  }

  log('');
  log('tile             size        az     el   span      grown px        cover the fade removed   cover px/texel');
  for (const tile of tiles) {
    log(`${tile.id.padEnd(16)} ${`${tile.width}x${tile.height}`.padEnd(10)} `
      + `${tile.azimuth.toFixed(1).padStart(6)} ${tile.elevation.toFixed(1).padStart(5)} `
      + `${(2 * Math.atan(tile.halfU) / DEG).toFixed(1).padStart(4)}x`
      + `${(2 * Math.atan(tile.halfV) / DEG).toFixed(1).padEnd(5)} `
      + `${tile.grown.map((v) => String(v).padStart(4)).join('')}  `
      + `${tile.fadeBandCover.map((v) => v.toFixed(3).padStart(7)).join('')} `
      + `${(tile.silhouette.areaRatio * 100).toFixed(0).padStart(6)}% `
      + `${tile.screenPerTexel.map((v) => v.toFixed(2)).join('-')}`);
  }
  log('');

  // The level the atlas is written against: the brightest thousandth is allowed
  // to clip rather than crushing every other texel's precision to protect it.
  // AND IT IS READ ON THE SKY THE REFERENCE CERTIFIED, not on the reserve.
  //
  // The scale is a percentile over every texel in the atlas, so a piece added to
  // the atlas moves it — by two thousandths, when eleven were added here — and
  // every texel of the photograph's own weather is then rounded against a
  // slightly different number. It comes back the same radiance, because the
  // shader multiplies the same scale back; it does not come back the same BYTE,
  // and one byte of a stored sRGB value is a level or two of the delivered
  // frame. Measured at the reference pose that was eleven per cent of the sky
  // moving by a level and thirty pixels moving by more.
  //
  // The derogation this unit works under says the reference frame does not
  // change by so much as a bit. So the scale is fixed by the tiles that stood
  // before the reserve existed, and the reserve is written against it. What that
  // costs is stated below rather than hidden: a reserve texel over the scale
  // clips instead of the whole atlas losing precision to it.
  const all = [];
  for (const tile of tiles) {
    if (tile.holesOnly) continue;
    for (let i = 0; i < tile.width * tile.height; i++) {
      if (tile.a[i] > 0.02) {
        all.push(Math.max(tile.rgb[i * 3], tile.rgb[i * 3 + 1], tile.rgb[i * 3 + 2]));
      }
    }
  }
  all.sort((a, b) => a - b);
  const levelScale = all.length ? all[Math.floor(all.length * 0.999)] : 1;
  log(`level scale ${levelScale.toFixed(4)} (median ${all[all.length >> 1].toFixed(4)}, `
    + `max ${all[all.length - 1].toFixed(4)})`);

  const bands = coverageByBand(material);
  // THE COMPOSITION IS PLANNED FIRST, AND IT DOES NOT MOVE.
  //
  // The holes are an addition to a sky the gates certified, not a reason to
  // deal it again. Planned first from an untouched ledger, the twenty seven
  // bearings outside the sector come out exactly as they came out before this
  // unit existed — which is what makes the first condition of the derogation
  // provable rather than hoped for: the reflection the water reads is built
  // from these and from nothing behind a block, so it is the same picture, so
  // the reference frame is the same frame. What the holes get is what the
  // ledger has left.
  const used = new Map();
  const free = planPlacements(tiles, bands, used);
  const holes = readHoles(material);
  log('');
  log('the sky behind the blocks, and what the photograph carries round it:');
  for (const hole of holes) {
    log(`  block ${hole.id}: az ${hole.azMin.toFixed(2)}..${hole.azMax.toFixed(2)} `
      + `el ${hole.elMin.toFixed(2)}..${hole.elMax.toFixed(2)}, of which `
      + `el ${hole.elLow.toFixed(2)}..${hole.elHigh.toFixed(2)} is sky the photograph lost; `
      + `the ring ${HOLE_RING_DEG} deg round it carries ${hole.weather.toFixed(3)} of coverage `
      + `(${hole.weather >= HOLE_WEATHER ? 'framed by weather, so it reads'
        : `under ${HOLE_WEATHER}, so nothing frames it`})`);
  }
  const fillers = planHoleFillers(tiles, holes, material, used, free);
  {
    // INVARIANT — a piece laid in a hole never leaves it.
    //
    // The derogation, stated as arithmetic. Everything the free pieces are held
    // to still holds for these; what is lifted for them, and only for them, is
    // the footprint rule above — because the sector they stand in is the one
    // part of it the photograph does not show.
    const report = [];
    const escapes = checkHoleCover(fillers, material, { report });
    log(`the library behind the blocks: ${fillers.length} piece(s) laid where the photograph `
      + `saw nothing, each with no drift (${HOLE_ARC_DEG} deg) so it cannot walk out from `
      + 'behind its block:');
    for (const line of report) log(line);
    for (const line of escapes) log(`  FAILED  ${line}`);
    if (escapes.length) {
      throw new Error(`${escapes.length} piece(s) laid in a hole reach outside the block that `
        + 'hides them');
    }
    if (HOLE_GROW !== 1) {
      throw new Error(`FARFIELD_HOLE_GROW is ${HOLE_GROW}: this run exists to show the `
        + 'invariant above failing, and it did not fail. Nothing is written');
    }
  }
  const placements = [...free, ...fillers];
  log(`library laid at ${free.length} bearings outside ${SECTOR[0]}..${SECTOR[1]} deg, `
    + `and behind ${fillers.length} block(s) inside it`);
  {
    // INVARIANT — the photograph's own sector belongs to the photograph.
    //
    // Read on the free pieces alone. A piece behind a block is inside the sector
    // by construction and answers to checkHoleCover instead, which is a stricter
    // rule and not a looser one: it has to stay inside nine degrees rather than
    // outside eighty.
    const trespass = checkPoseFootprint(placements.filter((p) => !p.hole));
    for (const line of trespass) log(`  FAILED  ${line}`);
    if (trespass.length) {
      throw new Error(`${trespass.length} library piece(s) reach inside the reference frame`);
    }
    log('  pose footprint: clear. The reference frame spans az '
      + `${POSE_WINDOW.azMin.toFixed(2)}..${POSE_WINDOW.azMax.toFixed(2)} el `
      + `${POSE_WINDOW.elMin.toFixed(2)}..${POSE_WINDOW.elMax.toFixed(2)}; `
      + `no free piece reaches it with ${DRIFT.arcLibrary} deg of drift spent `
      + `and ${POSE_CLEARANCE_DEG} deg of clearance`);
    // INVARIANT — no piece of the library stands twice in one frame.
    const pairs = checkTwins(placements);
    for (const line of pairs) log(`  FAILED  ${line}`);
    if (pairs.length) throw new Error(`${pairs.length} pair(s) of twins in the sky`);
    const spread = new Map();
    for (const p of placements) spread.set(p.tile.id, (spread.get(p.tile.id) || 0) + 1);
    log(`  twins: none. ${spread.size} pieces over ${placements.length} placements, `
      + `at most ${Math.max(...spread.values())} of any one, `
      + `never two inside ${FIELD_OF_VIEW.toFixed(1)} deg`);
  }
  {
    // What the plan actually delivers, band by band, against what the reference
    // carries there. Read rather than believed: the two are compared on the same
    // definition of coverage, the fraction of the band a piece's own mean
    // coverage occupies once its width in bearing is counted.
    const rows = bands.map((b) => {
      let sum = 0;
      for (const p of placements) {
        if (Math.abs(p.elevation - b.elevation) > 2 + Math.atan(p.tile.halfV * p.scale) / DEG) continue;
        const width = 2 * Math.atan(p.tile.halfU * p.scale) / DEG;
        let mean = 0;
        let n = 0;
        for (let i = 0; i < p.tile.width * p.tile.height; i++) { mean += p.tile.a[i]; n++; }
        sum += width * (mean / n);
      }
      return { at: b.elevation, wanted: b.cover, laid: sum / 360 };
    });
    log(`  band   reference   library`);
    for (const r of rows) {
      log(`  ${String(r.at).padStart(4)}     ${r.wanted.toFixed(3)}     ${r.laid.toFixed(3)}`);
    }
  }

  // A piece nothing stands on is weight and nothing else: the library is a pool
  // to draw from, and what the plan above did not draw does not travel.
  const laid = new Set(placements.map((p) => p.tile.id));
  const dropped = tiles.filter((t) => t.kind === 'library' && !laid.has(t.id));
  if (dropped.length) {
    log(`library pieces cut and not laid, so not shipped: ${dropped.map((t) => t.id).join(' ')}`);
    tiles = tiles.filter((t) => !dropped.includes(t));
  }

  // The composition, as one list, far first, exactly as the frame orders it.
  // Built here rather than beside the reflection it used to serve, because the
  // invariant below has to read the same thing the frame draws.
  const field = [
    ...tiles.filter((t) => t.kind !== 'library').map((tile) => ({
      tile,
      azimuth: tile.azimuth,
      elevation: tile.elevation,
      halfU: tile.halfU,
      halfV: tile.halfV,
      scale: 1,
      roll: 0,
      flip: 1,
      relit: false,
      // The veil is not a body standing in the world any more: src/core/sky.js
      // composites it into the dome, by direction. See drawField.
      inDome: tile.kind === 'veil',
    })),
    ...placements.map((p) => ({
      tile: p.tile,
      azimuth: p.azimuth,
      elevation: p.elevation,
      halfU: p.tile.halfU * p.scale,
      halfV: p.tile.halfV * p.scale,
      scale: p.scale,
      roll: p.roll,
      flip: p.flip,
      relit: true,
      // Which block hides it at the reference pose, or nothing. Carried into the
      // composition because the reflection below has to know: the equirect is
      // read BY DIRECTION and knows nothing of what stands in the way.
      hole: p.hole,
    })),
    // The veil goes behind everything, and not because it is low in the sky: it
    // was cut as the shortfall left standing in front of the dome, so anything
    // drawn before it would be counted twice.
  ].sort((a, b) => (a.tile.kind === 'veil' ? 0 : 1) - (b.tile.kind === 'veil' ? 0 : 1)
    || a.elevation - b.elevation);

  {
    // INVARIANT — nothing in this sky is drawn along a ruled line, from any of
    // the bearings the walk takes and not only from the one the photograph did.
    const straightest = referenceBar(material);
    const allowed = straightest.energy * BAR_MARGIN;
    log(`bars in the composition, from the lateral walk. The photograph's own weather `
      + `carries ${straightest.energy.toFixed(1)} of vertical edge down one column at most `
      + `(column ${straightest.x}, rows ${straightest.y0}..${straightest.y1}, peak step `
      + `${straightest.step.toFixed(3)}), so ${allowed.toFixed(1)} is allowed here:`);
    const lateral = checkLateralCuts(field, allowed);
    for (const line of lateral.report) log(line);
    for (const line of lateral.complaints) log(`  FAILED  ${line}`);
    if (lateral.complaints.length) {
      throw new Error(`${lateral.complaints.length} bearing(s) show a bar in the sky`);
    }
    // INVARIANT — nothing the photograph did not show draws a line, in the
    // levels the walker's own frame is delivered in, from where they stand.
    {
      // Both skies, and both judged: the sky the photograph was cut against, and
      // the dome the frame actually draws under this material. See
      // INVENTED_STEP for why the second one is no longer merely reported.
      const skies = [
        { under: material.dome, judged: true, name: 'the sky the photograph has' },
        { under: material.frameDome, judged: true, name: 'the dome the frame draws' },
      ];
      for (const sky of skies) {
        const invented = checkInventedEdges(field, material, sky);
        log(`what the invention draws over ${sky.name}, from the standing places the walk `
          + `takes (a row is entitled to ${INVENTED_TOLL} level before it counts)`
          + `${sky.judged ? '' : ' — READ, NOT JUDGED: the allowance below was measured on '
            + 'the other sky'}:`);
        for (const line of invented.report) log(line);
        for (const line of invented.complaints) log(`  FAILED  ${line}`);
        if (invented.complaints.length) {
          throw new Error(`${invented.complaints.length} standing place(s) show a line `
            + 'drawn by material the photograph never showed');
        }
      }
    }
    // INVARIANT — the greeting is read against sky, and never against weather.
    //
    // The corner the welcome text stands in carries the deepest blue of the
    // photograph, and a body of cloud drifting behind those words would be a
    // body that was not there when the composition was judged. Until the veil
    // this was stated in the frame, as byte identity between a render with the
    // field and one without it, and that statement no longer says what it meant:
    // the veil reaches the corner because the veil IS that deep blue, and it
    // takes the corner from 17.3 of DeltaE against the photograph to 5.9.
    //
    // So it is stated here instead, and about weather rather than about pixels.
    // Nothing that moves as a cloud moves may stand in the greeting; the sky
    // behind it may, because the sky behind it is what the greeting was always
    // read against.
    {
      const weather = field.filter((s) => s.tile.kind !== 'veil');
      const { cover } = drawField(weather, makeLateralCamera({ yaw: 0, pitch: POSE.pitch }));
      const worstWithin = (margin) => {
        let worst = 0;
        let at = [0, 0];
        for (let y = Math.max(0, WELCOME[1] - margin); y < Math.min(H, WELCOME[3] + margin); y++) {
          for (let x = Math.max(0, WELCOME[0] - margin); x < Math.min(W, WELCOME[2] + margin); x++) {
            if (cover[y * W + x] > worst) { worst = cover[y * W + x]; at = [x, y]; }
          }
        }
        return { worst, at };
      };
      const own = worstWithin(0);
      // And what the PHOTOGRAPH itself carries there, which is the only honest
      // ceiling: the greeting was laid out over this frame, and weather the
      // frame shows in that corner is weather the layout was judged against.
      // A number written down once from a composition that happened to be
      // carrying less than the photograph is a number that goes stale the moment
      // a window moves, which is exactly what happened when what stands behind
      // the blocks changed and the west window found its quiet border two
      // degrees further out.
      //
      // Read over the box and the two pixels round it, because that is the
      // width of the gather that put the photograph into a tile and the read
      // that takes it out again: a texel landing on the corner of this box
      // carries what the photograph shows a pixel or two outside it, and
      // charging the field for that would be charging it for resampling.
      const GATHER = 2;
      let reference = 0;
      for (let y = Math.max(0, WELCOME[1] - GATHER); y < Math.min(H, WELCOME[3] + GATHER); y++) {
        for (let x = Math.max(0, WELCOME[0] - GATHER); x < Math.min(W, WELCOME[2] + GATHER); x++) {
          const i = y * W + x;
          if (material.stone[i] || material.ground[i]) continue;
          reference = Math.max(reference, material.cutAlpha[i]);
        }
      }
      // How much room there is to spare, stated rather than assumed: the drift
      // is a fifth of a degree, which is five pixels of this framing, and the
      // greeting has to stay clear for the whole of a session and not only at
      // the frame the walker arrives on.
      // And how much of the greeting it touches at all, because a graze in one
      // corner and a bank across the words are the same number otherwise.
      let touched = 0;
      let total = 0;
      for (let y = WELCOME[1]; y < WELCOME[3]; y++) {
        for (let x = WELCOME[0]; x < WELCOME[2]; x++) {
          if (cover[y * W + x] > CELL_LIVE) touched++;
          total++;
        }
      }
      const allowed = Math.min(WELCOME_WEATHER, reference * (1 + 1e-9));
      log(`  the greeting ${WELCOME.join(',')}: worst weather coverage `
        + `${own.worst.toFixed(4)} at ${own.at.join(',')}, against `
        + `${allowed.toFixed(4)} allowed (the photograph itself carries `
        + `${reference.toFixed(4)} there, and a veil's worth is ${WELCOME_WEATHER}), `
        + `on ${touched} of its ${total} pixels (${(100 * touched / total).toFixed(2)}%)`);
      if (own.worst > allowed) {
        throw new Error('weather has moved into the greeting: '
          + `${own.worst.toFixed(4)} of coverage at ${own.at.join(',')}, over `
          + `${allowed.toFixed(4)}`);
      }
    }
    // INVARIANT — these clouds do not care what sky they are drawn on.
    {
      const weather = field.filter((s) => s.tile.kind !== 'veil');
      const skies = checkTwoSkies(weather, readDayPreset(), material.cloudCeiling, material.sun);
      log(`the two skies — the dome the frame draws and the same dome a fifth darker. `
        + `The brightest colour any texel asks of a cloud is ${skies.asked.toFixed(2)} against `
        + `the ${Math.max(...material.cloudCeiling).toFixed(2)} this photograph's own cloud `
        + `carries (${skies.askedAt}); where the cover says nothing the frame draws `
        + `${skies.meanNothing.toFixed(1)} levels on average of ${SKY_TOLL} allowed, worst `
        + `${skies.worstNothing.toFixed(1)}`
        + `${skies.worstNothingAt ? ` (${skies.worstNothingAt})` : ''}:`);
      for (const line of skies.report) log(line);
      for (const line of skies.complaints) log(`  FAILED  ${line}`);
      if (skies.complaints.length) {
        const fault = new Error(`${skies.complaints.length} way(s) in which this weather still `
          + 'carries the sky it was cut from');
        if (SKY_LAYER) throw fault;
        carried.push(fault);
      }
    }
    // And the reading, shown finding the eighth gate's own slab rather than
    // trusted to. Put back by hand on the bearing it was reported from, it must
    // come out over the allowance; if it does not, the invariant above passed
    // because it cannot see, and the bake says so instead of shipping.
    {
      const bearing = LATERAL_BEARINGS[0];
      const { cover } = drawField(field, makeLateralCamera(bearing));
      const clean = barEnergy(cover).energy;
      const slab = layTestSlab(cover, bearing.pitch);
      const found = barEnergy(slab.cover);
      log(`  the eighth gate's slab, put back on ${bearing.id}: ${SLAB_DEG} deg wide, `
        + `${slab.rows} rows tall, ${SLAB_COVER} of coverage deep at column ${slab.column} `
        + `-> ${found.energy.toFixed(1)} at column ${found.x}, against ${clean.toFixed(1)} `
        + `without it and ${allowed.toFixed(1)} allowed`);
      if (found.energy <= allowed || Math.abs(found.x - slab.column) > BAR_FAR) {
        throw new Error('the bar reading does not find the slab the eighth gate found: '
          + `${found.energy.toFixed(1)} at column ${found.x}, wanted more than `
          + `${allowed.toFixed(1)} at column ${slab.column}`);
      }
    }
  }

  // Before a single byte is packed: whatever the handle asked to be carried so
  // that the gates behind it could be read is now the end of the run.
  if (carried.length) {
    for (const fault of carried) log(`  FAILED  ${fault.message}`);
    throw new Error(`${carried.length} invariant(s) failed on this material; nothing written`);
  }

  const layout = packAtlas(tiles);
  const image = Buffer.alloc(ATLAS.width * ATLAS.height * 4);
  let clipped = 0;
  for (const tile of tiles) {
    for (let j = 0; j < tile.height; j++) {
      for (let i = 0; i < tile.width; i++) {
        const o = j * tile.width + i;
        const d = ((tile.rect.y + j) * ATLAS.width + tile.rect.x + i) * 4;
        for (let k = 0; k < 3; k++) {
          const v = tile.rgb[o * 3 + k] / levelScale;
          if (v > 1) clipped++;
          // Written through the transfer function the texture is read back with.
          // Eight bits spread linearly over this range put their steps where a
          // cloud has none and none where a belly needs them; through the curve
          // the step is proportional and the atlas bands nowhere. The coverage
          // stays linear, which is what an alpha channel is.
          image[d + k] = Math.max(0, Math.min(255,
            Math.round(linearToSrgb(Math.max(0, Math.min(1, v))) * 255)));
        }
        image[d + 3] = Math.max(0, Math.min(255, Math.round(tile.a[o] * 255)));
      }
    }
  }
  const bytes = await writeCleanPng(image, { ...ATLAS, channels: 4 }, OUT_IMAGE);
  const dump = process.argv.find((v) => v.startsWith('--dump='));
  if (dump) await dumpTiles(tiles, material, dump.slice(7));

  // The same field, as one picture indexed by direction, for the surfaces that
  // reflect the sky — WITHOUT what stands behind the blocks.
  //
  // This map is read by direction and has no notion of what is in the way, so a
  // piece that exists only behind a monolith would be reflected by every
  // surface in the world whether or not that surface can see behind it — the
  // water at the reference pose included, where by the first condition of the
  // derogation nothing may change by a bit. What the water gives up is the
  // reflection of a cloud it cannot see; what it keeps is the reference frame,
  // unchanged.
  const reflection = bakeEquirect(field.filter((s) => !s.hole), material.sun);
  const equirect = Buffer.alloc(EQUIRECT.width * EQUIRECT.height * 4);
  for (let i = 0; i < EQUIRECT.width * EQUIRECT.height; i++) {
    for (let k = 0; k < 3; k++) {
      // Through the same transfer function and against the same level scale as
      // the atlas, so a surface reading this and a surface reading the sprites
      // are reading the same radiance.
      const value = Math.max(0, Math.min(1, reflection.data[i * 4 + k] / levelScale));
      equirect[i * 4 + k] = Math.round(linearToSrgb(value) * 255);
    }
    equirect[i * 4 + 3] = Math.max(0, Math.min(255,
      Math.round(reflection.data[i * 4 + 3] * 255)));
  }
  const equirectBytes = await writeCleanPng(
    equirect, { ...EQUIRECT, channels: 4 }, OUT_EQUIRECT,
  );

  const manifest = {
    atlas: { width: ATLAS.width, height: ATLAS.height, levelScale: round(levelScale, 5) },
    // What is in here, counted, because three documents have called it three
    // things and a gate has now tripped over the difference. The word "mass" is
    // a KIND — a whole piece of the reference's own weather, of which there are
    // two heroes and four masses — and it is not the number of things standing
    // in the sky, which is those six plus the placements below, nor the number
    // of tiles in the atlas, which counts the library and the veil as well.
    counts: {
      whole: tiles.filter((t) => t.kind === 'hero' || t.kind === 'mass').length,
      hero: tiles.filter((t) => t.kind === 'hero').length,
      mass: tiles.filter((t) => t.kind === 'mass').length,
      library: tiles.filter((t) => t.kind === 'library').length,
      veil: tiles.filter((t) => t.kind === 'veil').length,
      tiles: tiles.length,
      placements: placements.length,
      distinctPlaced: new Set(placements.map((p) => p.tile)).size,
      standing: tiles.filter((t) => t.kind === 'hero' || t.kind === 'mass').length + placements.length,
    },
    sun: {
      elevation: material.fit.sun.elevation,
      azimuth: material.azimuth,
      vector: material.sun.map((v) => round(v, 5)),
    },
    // What a piece that moves is relit with. The coefficients are the sky bake's
    // own, imported rather than repeated, and they travel with the atlas because
    // the shader that multiplies them back must never be able to drift from the
    // tool that divided by them.
    shade: {
      ambient: SHADE_AMBIENT,
      diffuse: SHADE_DIFFUSE,
      forward: SHADE_FORWARD,
      normalSlope: NORMAL_SLOPE,
    },
    // The brightest colour a texel of this atlas asks of a cloud, per channel,
    // which is what the reference's own solid cloud carries. Every texel here
    // is a coverage times a colour under this, which is why the field
    // composites the same way on any sky — written down so the bound can be
    // read off the shipped asset rather than taken on trust.
    ceiling: material.cloudCeiling.map((v) => round(v, 4)),
    // What the reference carries at each height, and where the library was laid
    // to carry the same across the bearings it never showed.
    bands,
    placements: placements.map((p) => ({
      id: p.id,
      tile: p.tile.id,
      azimuth: round(p.azimuth, 3),
      elevation: round(p.elevation, 3),
      scale: round(p.scale, 4),
      roll: round(p.roll, 2),
      flip: p.flip,
      distance: p.distance,
      // Which block hides this piece at the reference pose, when one does, and
      // the excursion it is allowed. The pair travels together: the licence to
      // stand inside the reference's own sector is the licence to stay behind
      // one block, and an arc is the one thing that would spend it.
      hole: p.hole,
      arc: p.hole ? HOLE_ARC_DEG : undefined,
    })),
    tiles: tiles.map((tile) => ({
      id: tile.id,
      kind: tile.kind,
      rect: tile.rect,
      // Where it was cut from, which for a mass is also where it goes.
      azimuth: round(tile.azimuth, 3),
      elevation: round(tile.elevation, 3),
      halfU: round(tile.halfU, 6),
      halfV: round(tile.halfV, 6),
      // The sun in the local frame of the place it was cut from, which is what
      // a piece laid down elsewhere has to be divided by.
      sunSource: tile.sunSource.map((v) => round(v, 5)),
      // Degrees of sky one texel of this tile spans, so the shader can state the
      // coverage gradient per degree whatever scale the sprite is drawn at.
      degPerTexel: round(tile.degPerTexel, 6),
      // The quads the frame draws this piece as — and none, for the veil, which
      // the dome composites by direction over its whole rectangle. The cut is
      // still made and still shapes the equirect the water reflects; what does
      // not travel is a set of quads nothing is going to rasterise, and leaving
      // them here would be an invitation to stand the veil up again.
      parts: tile.kind === 'veil' ? undefined
        : tile.silhouette.parts.map((p) => p.map((v) => round(v, 4))),
      cells: tile.silhouette.cells,
      areaRatio: round(tile.silhouette.areaRatio, 4),
      borderAlpha: round(tile.borderAlpha, 6),
      fadeBandCover: tile.fadeBandCover.map((v) => round(v, 4)),
    })),
  };
  writeFileSync(OUT_PARAMS, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const worstBorder = Math.max(...tiles.map((t) => t.borderAlpha));
  const worstBand = Math.max(...tiles.flatMap((t) => t.fadeBandCover));
  log('');
  log(`atlas ${ATLAS.width}x${ATLAS.height}: ${tiles.length} tiles, `
    + `${(layout.occupancy * 100).toFixed(1)}% occupied, bottom row ${layout.bottom}`);
  log(`border coverage, worst of every tile: ${worstBorder.toExponential(2)} `
    + `(one 8 bit step is ${(1 / 255).toExponential(2)})`);
  log(`coverage the fade had to remove, worst side of any tile: ${worstBand.toFixed(3)}`);
  log(`colour clipped on ${clipped} channels of ${3 * ATLAS.width * ATLAS.height}`);
  log(`silhouettes cover ${(100 * tiles.reduce((t, s) => t + s.silhouette.areaRatio, 0) / tiles.length).toFixed(0)}%`
    + ' of their rectangles on average');
  log(`png ${(bytes / 1024).toFixed(0)} kB -> ${OUT_IMAGE}`);
  log(`equirect ${EQUIRECT.width}x${EQUIRECT.height}: `
    + `${(reflection.covered * 100).toFixed(1)}% of the sphere carries cloud, `
    + `${(equirectBytes / 1024).toFixed(0)} kB -> ${OUT_EQUIRECT}`);
  log(`${OUT_PARAMS}`);
  log(`${((Date.now() - started) / 1000).toFixed(1)} s`);
}

await main();
