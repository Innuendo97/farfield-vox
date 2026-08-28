import { readFileSync } from 'node:fs';
import { FRAME } from './framing.mjs';

// The two radial darkenings that stand between the reference image and the
// radiance it was a photograph of.
//
// Every bake that reads pixels out of the reference has to divide both of them
// out, and every one of them has to divide out the same two, or the same piece
// of sky arrives at two different brightnesses depending on which tool cut it.
// So they live here rather than in the tool that needed them first.

/** Squared screen radius of a pixel, normalised so the corners are at one. */
export function screenRadius(px, py) {
  const du = (px + 0.5) / FRAME.width - 0.5;
  const dv = (py + 0.5) / FRAME.height - 0.5;
  return (du * du + dv * dv) * 2;
}

/**
 * The lens shading the arrival composition carries, read from where it lives.
 *
 * The reference already carries it, and the frame carries it again over the sky
 * it is given, so a sector copied across as it stands arrives at the corners of
 * the frame darkened twice. Dividing it out here is what makes "the pixels of
 * the reference" true at the corners as well as at the centre. Parsed rather
 * than written down, so it cannot drift away from the code that applies it.
 *
 * IT MOVED, and the number did not. Until 2026-08-20 this was a permanent
 * multiply inside the composite pass and was parsed out of src/core/post.js;
 * the committente's decision of 2026-08-19 put the whole of this picture's
 * corner shading into the arrival veil, which is transient, so it is parsed out
 * of src/ui/veil.js instead. Same strength, same law, one sede. What that
 * changes for anything downstream is only WHEN the frame carries it: at the
 * spawn, which is the one moment the reference is a photograph of, and which is
 * the only moment any of these bakes reads.
 */
export function makeLensShading() {
  const source = readFileSync(new URL('../../../src/ui/veil.js', import.meta.url), 'utf8');
  const found = /LENS_VIGNETTE\s*=\s*([0-9.]+)/.exec(source);
  if (!found) throw new Error('lens vignette strength not found in src/ui/veil.js');
  const strength = Number(found[1]);
  return {
    strength,
    at(px, py) {
      return 1 - strength * screenRadius(px, py);
    },
  };
}

// The shading the reference carries that the composite pass does not, as the
// fraction of the centre's light that survives at a corner of the frame.
//
// The reference darkens towards its corners, and two stories fit that equally
// well: a shading of the picture, and a sky that really is darker away from its
// sun. They are measured on the same pixels of the same single photograph, so
// nothing separates them by itself. Two ways of asking have now been tried and
// both answer that the question has no answer.
//
// Ask the fit. Divide a candidate out, refit, and read how much radial darkening
// the fitted sky still carries: 0.207 of the centre with nothing divided out,
// 0.216 at eight tenths, 0.184 at a half. It does not move, because within one
// frame the screen radius is very nearly a function of the height and the
// bearing, which is exactly what the model's exposure and its bearing surface
// are free in. Whatever is handed to them they absorb.
//
// Ask the dome, which is what the darkening actually damages. Bake the whole sky
// at each candidate and read it band by band for closed blotches of level and of
// tint: 3.20 / 2.20 / 3.59 units at eight tenths, 3.15 / 2.22 / 3.68 at seven,
// 3.13 / 2.44 / 3.74 at six, 3.23 / 2.53 / 3.78 at 0.55, 3.27 / 2.25 / 3.39 at
// 0.45. Flat, for the same reason: the fit follows the candidate.
//
// So the depth of this is not identifiable from this picture, and the value is
// held where it was rather than moved to a number that cannot be defended. What
// made the previous value a compromise was never its depth — it was that the
// measurement it left behind was carried out across the whole sky, where it
// became a dark patch pinned to a bearing. That is fixed where it belongs, in
// grade-sky.mjs: outside the photograph's own frame the dome is now the clean
// model and carries no measurement at all, at any shading. What is still divided
// out here the interface puts back over the whole frame while the walker is
// arriving, which is where a lens effect belongs.
export const REFERENCE_SHADING_CORNER = 0.8;

/**
 * The shading above, as a field over the frame.
 *
 * Linear in the squared radius, which is the same shape the composite pass uses
 * and the same shape a lens has: the two are then one field with one exponent,
 * and the interface has one curve to draw rather than two to compose.
 */
export const referenceShading = (q) => 1 - (1 - REFERENCE_SHADING_CORNER)
  * Math.min(1, Math.max(0, q));

// ---------------------------------------------------------------------------

// The shading the arrival composition carries, as a table over the frame.
//
// The constant above is what this bake divides out of the reference before it
// fits a sky. It is not the whole of what the interface has to put back, and
// assuming it was is what left the corners of the arrival frame nineteen units
// of DeltaE away from the reference at the tenth gate.
//
// Two things separate the frame the product draws from the photograph, and only
// one of them is that constant. The other is that the dome is a smooth fitted
// sky — model plus bearing surface, aureole and all — and the photograph departs
// from that smooth sky, most of all towards its upper left, where it goes deep
// and grey while the model stays open blue. Those departures belong to one
// standing place looking one way. Carried into the dome they would be a dark
// patch of sky pinned to a bearing, found again from everywhere else in the hub;
// that is exactly the dark rectangle the walker complained about, and it is why
// the dome no longer carries them. So they belong here, with the rest of what
// the framing owns, and they are measured rather than modelled.
//
// Measured how: tools/grade/fit-veil.mjs divides the reference by the frame the
// product actually draws without the veil, on the sky, robustly, knot by knot.
// The answer has almost nothing of a lens in it — it is near nine tenths over
// most of the frame and falls to a fifth in one corner — which is the honest
// shape of "one photograph minus one smooth sky", and no radial law fits it. A
// law was tried: fitted radially it ruins the right hand corner to pay for the
// left, because at the same radius the reference wants a fifth of the light on
// one side and nine tenths on the other.
//
// It is bilinear over the frame, which is the form a lens shading correction has
// always taken, and coarse — a knot every hundred pixels — with a curvature
// penalty in the fit, so that where the product and the photograph merely put a
// cloud in different places the field cannot answer with a cloud shaped patch.
export const ARRIVAL_SHADING = {
  cols: 17,
  rows: 10,
  values: [
    0.226, 0.305, 0.477, 0.579, 0.707, 0.839, 0.960, 1.000, 0.915, 0.894, 0.891, 0.793, 0.722, 0.665, 0.724, 0.804, 0.463,
    0.232, 0.337, 0.502, 0.673, 0.897, 0.978, 1.000, 1.000, 0.993, 1.000, 0.813, 0.877, 0.855, 0.758, 0.846, 0.844, 0.813,
    0.327, 0.412, 0.624, 0.848, 0.955, 1.000, 1.000, 1.000, 0.997, 0.958, 0.935, 0.903, 0.901, 0.903, 0.891, 0.839, 0.633,
    0.649, 0.743, 0.894, 0.952, 0.900, 0.969, 0.981, 0.971, 0.973, 0.961, 0.952, 0.942, 0.934, 0.930, 0.887, 0.866, 0.854,
    0.891, 0.910, 0.917, 0.941, 0.957, 0.956, 0.967, 0.972, 0.962, 0.968, 0.937, 0.940, 0.950, 0.930, 0.923, 0.908, 0.772,
    0.908, 0.915, 0.924, 0.936, 0.946, 0.952, 0.960, 0.974, 0.934, 0.873, 0.894, 0.918, 0.925, 0.918, 0.908, 0.887, 0.844,
    0.917, 0.921, 0.927, 0.934, 0.940, 0.945, 0.948, 0.946, 0.928, 0.906, 0.906, 0.912, 0.915, 0.910, 0.901, 0.888, 0.873,
    0.922, 0.924, 0.928, 0.932, 0.936, 0.939, 0.939, 0.936, 0.926, 0.916, 0.912, 0.912, 0.910, 0.906, 0.900, 0.892, 0.885,
    0.924, 0.926, 0.928, 0.931, 0.934, 0.935, 0.934, 0.931, 0.925, 0.919, 0.914, 0.912, 0.909, 0.905, 0.900, 0.895, 0.891,
    0.926, 0.927, 0.929, 0.931, 0.933, 0.933, 0.932, 0.929, 0.925, 0.920, 0.915, 0.912, 0.908, 0.905, 0.900, 0.896, 0.894,
  ],
};
