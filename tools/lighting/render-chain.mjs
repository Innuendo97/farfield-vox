import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { agx } from '../grade/lib/agx.mjs';
import { pigmentCensus } from '../../src/world/voxel/pure.js';
import { REPO_ROOT, sunVector } from './sun.mjs';

// THE FRAME'S OWN LIGHT, OFFLINE: scene light -> the pixel a face comes out as.
//
// WHY IT HAS TO EXIST. What an estimator reads off a target is an ENCODED
// ratio; the two strengths in scene-light.json act in LINEAR light; and the
// curve between them is neither a gamma nor a straight line. So the orientation
// ladder cannot be compared against a target by arithmetic on the strengths --
// it has to be carried through the same tone curve and the same grade cube the
// frame carries it through. With this, the ladder is SOLVED instead of swept,
// and solved without a browser, which is what lets a guard ask the question at
// every commit rather than at every screenshot.
//
// WHAT IS IN IT AND WHAT IS DELIBERATELY NOT. AgX from tools/grade/lib/agx.mjs,
// sRGB, and the delivered grade cube sampled with the same arithmetic as
// tools/terrain/probe.mjs. NOT the lens shading: src/ui/veil.js draws that over
// the arrival composition only, and it is gone by the time anything is measured.
//
// THE NUMBERS ARE READ, NEVER RESTATED. GROUND_EXPOSURE and the meadow's albedo
// are lifted out of the shipped sources as text rather than copied here, because
// a second copy of either is a model that keeps predicting the world of the day
// it was written. That is also why they are read and not imported: the modules
// that hold them reach three.js and JSON imports, and an offline chain that
// needed a browser to answer would not be a chain anyone could gate on.

const LUT_PATH = join(REPO_ROOT, 'public', 'assets', 'grade-lut.png');

const source = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');
const json = (rel) => JSON.parse(source(rel));

/** src/world/air.js GROUND_EXPOSURE, read rather than restated. */
export const GROUND_EXPOSURE = Number(
  /GROUND_EXPOSURE = ([0-9.]+)/.exec(source('src/world/air.js'))[1],
);

// THE MEADOW'S PIGMENT, IMPORTED AND NOT SCRAPED, and the change is not a
// tidying: it is the only way this chain still works.
//
// This file used to lift the meadow's albedo out of material.js as TEXT, with a
// regular expression, for the reason stated above -- the modules that hold it
// reach three.js. That was possible while the pigment was ONE TRIPLE. It is a
// FIELD now, two octaves of value noise in the world's own XZ with a band closed
// on it, and there is no regular expression for a field: a chain that went on
// quoting the base triple would be modelling a meadow this render no longer
// draws.
//
// So the pigment was made a PURE FUNCTION in src/world/voxel/pigment.js, beside
// the shader that reproduces it, and it comes through src/world/voxel/pure.js --
// the half of the engine's door that a browser is not required for. This chain
// imports the arithmetic the page draws with. That is residuo 1 of
// E-FOND-PIANO11, and it is why the offline reading of the meadow exists again.
//
// WHICH COLUMN OF A FIELD THE LADDER IS READ AT is a question a single albedo
// never had to answer, and it is answered by measuring rather than by choosing:
// the census below walks 65 536 columns of the field and hands back its own
// median. The two ends come back with it, because the tone curve is not a
// straight line and the gate should show the band it is quoting the middle of.
export const MEADOW_FIELD = pigmentCensus('meadow');
export const EARTH_FIELD = pigmentCensus('earth');
export const MEADOW_ALBEDO = MEADOW_FIELD.albedo.p50;
export const EARTH_ALBEDO = EARTH_FIELD.albedo.p50;

/** What the meadow's material hands faceLightUniforms as its own exposure. */
export const LIGHT_SCALE = json('assets-src/terrain/terrain.json').lightScale * GROUND_EXPOSURE;

const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** Rec.709 luminance of an ENCODED triple, which is what an estimator reads. */
export const encodedLum = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

/** The two terms src/world/face-light.js produces for a normal. */
export function faceTerms(n, sun) {
  return [
    Math.max(n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2], 0),
    0.5 + 0.5 * n[1],
  ];
}

/** A horizontal bearing as a unit normal, with north at -Z. */
export function flank(bearing) {
  const rad = bearing * Math.PI / 180;
  return [Math.sin(rad), 0, -Math.cos(rad)];
}

/** The light seat as this chain needs it: two angles and two strengths. */
export function readLight() {
  const sky = json('assets-src/sky/sky.json');
  const scene = json('assets-src/sky/scene-light.json');
  return {
    elevation: sky.day.sun.elevation,
    azimuth: sky.day.sun.azimuth,
    sunStrength: scene.day.sunStrength,
    skyStrength: scene.day.skyStrength,
    sunBeam: scene.day.sunBeam,
    skyBalance: scene.day.skyBalance,
  };
}

/**
 * Scene-linear colour of one face, before the tone curve.
 *
 * bakedLight() in src/core/sky.js is two terms against two colours, and this is
 * that line in another language: the sun term against the beam times its
 * strength, the sky term against the balance times its own. The lift is not a
 * factor here because a delivery ships it at one -- guard-lift.mjs is what
 * keeps that true.
 */
export function faceColour(n, light, albedo = MEADOW_ALBEDO) {
  const sun = sunVector(light.elevation, light.azimuth);
  const [ts, tk] = faceTerms(n, sun);
  return [0, 1, 2].map((c) => albedo[c] * LIGHT_SCALE
    * (ts * light.sunBeam[c] * light.sunStrength + tk * light.skyBalance[c] * light.skyStrength));
}

async function loadLut() {
  const { data, info } = await sharp(LUT_PATH).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, size: info.height };
}

function tap(lut, u, v, out) {
  const x = Math.min(lut.width - 1.001, Math.max(0, u * lut.width - 0.5));
  const y = Math.min(lut.size - 1.001, Math.max(0, v * lut.size - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = Math.min(lut.width - 1, x0 + 1);
  const y1 = Math.min(lut.size - 1, y0 + 1);
  for (let c = 0; c < 3; c++) {
    const a = lut.data[(y0 * lut.width + x0) * 4 + c];
    const b = lut.data[(y0 * lut.width + x1) * 4 + c];
    const d = lut.data[(y1 * lut.width + x0) * 4 + c];
    const e = lut.data[(y1 * lut.width + x1) * 4 + c];
    out[c] = ((a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy) / 255;
  }
  return out;
}

// The cube as tools/terrain/probe.mjs unrolls it: side N laid out in a strip
// N*N wide, filtered inside a slice and interpolated by hand across slices.
// Restating this wrong is how an offline model quietly stops being the frame.
function grade(lut, colour, out) {
  const n = lut.size;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const blue = clamp(colour[2]) * (n - 1);
  const slice = Math.floor(blue);
  const t = blue - slice;
  const u = (0.5 + clamp(colour[0]) * (n - 1)) / n;
  const v = (0.5 + clamp(colour[1]) * (n - 1)) / n;
  const low = tap(lut, (slice + u) / n, v, [0, 0, 0]);
  const high = tap(lut, (Math.min(slice + 1, n - 1) + u) / n, v, [0, 0, 0]);
  for (let c = 0; c < 3; c++) out[c] = low[c] + (high[c] - low[c]) * t;
  return out;
}

/**
 * The composite, once the cube is on hand: scene-linear in, encoded 0-255 out.
 *
 * @returns {(colour: number[]) => number[]}
 */
export async function renderChain() {
  const lut = await loadLut();
  const tone = [0, 0, 0];
  return function composite(colour) {
    agx(colour, 1, tone);
    const srgb = tone.map((v) => linearToSrgb(Math.max(0, v)));
    return grade(lut, srgb, [0, 0, 0]).map((v) => Math.max(0, Math.min(255, v * 255)));
  };
}

/**
 * The orientation ladder of one material under one light, brightest first.
 *
 * THE ORIENTATIONS ARE KNOWN HERE AND THAT IS THE WHOLE POINT. A ladder read off
 * a meadow by clustering asks three centres to hold four populations -- cube
 * tops, two flanks and a scatter of flowers -- and the rung that suffers is the
 * middle one. Here each rung IS a normal, so nothing is being guessed.
 *
 * @param {(colour: number[]) => number[]} composite from renderChain()
 * @param {object} light from readLight()
 * @param {number[]} albedo the material's own pigment
 */
export function orientationLadder(composite, light, albedo = MEADOW_ALBEDO) {
  const faces = [
    { name: 'top', normal: [0, 1, 0] },
    { name: 'flank 270 (west)', normal: flank(270) },
    { name: 'flank 180 (south)', normal: flank(180) },
  ];
  const rungs = faces.map((face) => {
    const rgb = composite(faceColour(face.normal, light, albedo));
    return { ...face, rgb, lum: encodedLum(rgb) };
  }).sort((a, b) => b.lum - a.lum);
  return rungs.map((rung) => ({ ...rung, rung: rung.lum / rungs[0].lum }));
}
