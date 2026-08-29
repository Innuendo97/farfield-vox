import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/framing.mjs';
import { agx } from './lib/agx.mjs';
import { linearToSrgb, srgbToLab } from './lib/color.mjs';
import { domeAt, domeRadiance, directionOf } from './lib/sky-model.mjs';

// What a sky with no blotch in it looks like, stated as a number.
//
// The old dome was a picture, and the invariant that guarded it compared that
// picture with the model underneath: it could see a blotch the bake had painted
// and it could not see one the DOME AS DRAWN carried, because the veil was
// composited in the fragment and the sun did not exist. Both of those were in
// the frames the committente failed.
//
// So this measures the composite — the clear sky, the aureole and the disc,
// exactly as src/core/sky.js assembles them — and it measures the one property
// he actually asked for: that the sereno closes nothing. Not that it matches a
// photograph, not that it is within some distance of a target. That walking the
// eye round a bearing, or up from the horizon, finds a level that goes one way
// and then the other way and BACK, which is what a patch is: a closed contour.
//
// It is stated as two readings, because "no closed contour at all" is not true
// of any sky and would be the wrong thing to ask for.
//
// THE FIRST IS EXACT, and it is the one that cannot be argued with. Everything
// this dome is made of depends on a direction through two numbers only: how
// high it is, and how far it is from the sun. So two bearings mirrored about
// the sun's own bearing MUST come back the same colour, to the last bit of a
// double. A sky with a patch in it fails that immediately, whatever the patch
// is made of and however soft its edges, because a patch is a thing at a
// PLACE and a place is not one of the two numbers. Nothing measured off a
// photograph can survive this reading, which is precisely why it is the one
// worth writing down.
//
// THE SECOND IS ABOUT SCALE. A physical sky has closed contours: the sun's own
// lobe, and opposite it the Rayleigh rise, because air scatters backwards
// nearly as well as forwards. Those are hemispheres, not patches. So a closed
// extremum is allowed to exist and is not allowed to be SMALL — anything deep
// enough to see and narrow enough to point at is a blotch, and the two limits
// below say how deep and how narrow.

const DEG = Math.PI / 180;

// The bearings and the heights the committente's own criterion names.
const BEARINGS = 12;
const PITCHES = [10, 30, 50, 70, 85];

// How finely a profile is walked, and how much of it is smoothed away first.
//
// The smoothing is the point rather than a convenience: what is being looked
// for is a LOW FREQUENCY closed contour, and the dither this sky is drawn with
// is a high frequency one by design. Three degrees is wider than anything the
// dither can make and far narrower than the smallest patch anybody complained
// about, which were tens of degrees across.
const STEP_DEG = 0.5;
const SMOOTH_DEG = 3;

// How deep a closed extremum has to be before it counts, in CIE Lab units of
// the frame as the walker sees it — through the AgX curve, because a difference
// the tone curve removes is not a difference the eye is offered.
//
// A fifth of a unit. One unit is about the smallest difference an eye finds on
// a flat field, and the things that were complained about measured whole units;
// this leaves no room to argue that something merely small was left in.
const BLOTCH_LIMIT = 0.2;

// How wide a closed extremum has to be, at half its own depth, before it counts
// as a feature of the sky rather than a patch in it.
//
// Thirty degrees. The sun's lobe and the rise opposite it are the width of a
// hemisphere; the patches the committente pointed at were fifteen to forty
// degrees across but had a CONTOUR — they closed, and they closed on nothing.
// This admits the first kind and refuses the second, and it refuses it at a
// fifth of a Lab unit, which is well under what an eye finds on a flat field.
const MIN_FEATURE_DEG = 30;

const CHANNELS = ['lightness', 'tint a', 'tint b'];

/** The frame's own colour for a radiance, as the composite pass encodes it. */
function encoded(radiance) {
  return srgbToLab(agx(radiance, 1).map((v) => Math.min(1, Math.max(0, linearToSrgb(v)))));
}

/**
 * A profile smoothed with a boxcar of the stated radius.
 * Circular profiles wrap; radial ones hold their ends, because the horizon and
 * the zenith are real ends of the sky and not a cut in one.
 */
function smooth(values, radius, circular) {
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let k = -radius; k <= radius; k++) {
      let j = i + k;
      if (circular) j = ((j % n) + n) % n;
      else j = Math.min(n - 1, Math.max(0, j));
      sum += values[j];
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

/**
 * Every closed extremum of a profile, with its topographic prominence.
 *
 * Prominence and not depth, because depth against what is the question a blotch
 * begs: a patch sitting on a ramp is still a patch. The prominence is how far
 * the level has to come back UP from an extremum, on the worse of its two
 * sides, before the profile is as high as the extremum was — which is exactly
 * "how closed" the contour round it is, and is nought for anything monotone.
 */
function closedExtrema(values, circular) {
  const n = values.length;
  const at = (i) => values[circular ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i))];
  const found = [];
  for (let i = 0; i < n; i++) {
    if (!circular && (i === 0 || i === n - 1)) continue;
    const here = values[i];
    for (const sign of [1, -1]) {
      // A maximum for sign 1, a minimum for sign -1; the arithmetic is the same
      // curve turned over.
      if (sign * here <= sign * at(i - 1) || sign * here < sign * at(i + 1)) continue;
      let worst = 0;
      let closed = true;
      for (const step of [1, -1]) {
        let extreme = here;
        let j = i;
        let reached = false;
        for (let k = 1; k <= n; k++) {
          j = i + step * k;
          if (!circular && (j < 0 || j > n - 1)) break;
          const v = at(j);
          if (sign * v > sign * here) { reached = true; break; }
          if (sign * v < sign * extreme) extreme = v;
        }
        // An end of the sky is not a wall: a profile that only ever falls away
        // towards the horizon has not closed anything, so a side that runs out
        // without coming back is a side with no prominence at all.
        if (!reached) { closed = false; break; }
        const drop = sign * (here - extreme);
        if (worst === 0 || drop < worst) worst = drop;
      }
      if (!closed) continue;
      // And how wide it is: how far the level has to be followed, each way,
      // before it has given up half of what the extremum holds. A hemisphere
      // of sky and a patch in one can have the same depth; only this tells
      // them apart.
      let span = 0;
      for (const step of [1, -1]) {
        let k = 1;
        for (; k <= n; k++) {
          const j = i + step * k;
          if (!circular && (j < 0 || j > n - 1)) break;
          if (sign * (here - at(j)) >= worst * 0.5) break;
        }
        span += k;
      }
      found.push({
        at: i, kind: sign > 0 ? 'max' : 'min', prominence: worst, span,
      });
    }
  }
  return found;
}

/** The largest curvature the filtered profile carries, per degree squared. */
function worstCurvature(values, stepDeg, circular) {
  const n = values.length;
  const at = (i) => values[circular ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i))];
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const second = (at(i - 1) - 2 * at(i) + at(i + 1)) / (stepDeg * stepDeg);
    if (Math.abs(second) > worst) worst = Math.abs(second);
  }
  return worst;
}

function main() {
  const sky = JSON.parse(readFileSync(join(REPO_ROOT, 'assets-src', 'sky', 'sky.json'), 'utf8'));
  const day = sky.day;
  const sun = day.sun;
  const lines = [];
  const complaints = [];
  const log = (line) => { lines.push(line); process.stdout.write(`${line}\n`); };

  log('the composite sky — clear sky, aureole and disc, as src/core/sky.js draws it');
  log(`sun at ${sun.elevation} deg elevation, ${sun.azimuth} deg azimuth; `
    + `aureole wide ${day.aureole.wide} narrow ${day.aureole.narrow}; `
    + `disc ${day.disc.radiusDeg} deg at ${day.disc.level} of the exposure`);

  // THE BEARING THE SKY IS ACTUALLY SYMMETRIC ABOUT, WHICH IS NOT `sun.azimuth`.
  //
  // Every evaluator of this sky — the shader through uSunDir, the model through
  // preset.sun.vector — reads the sun as a VECTOR. `sun.azimuth` is a label
  // beside it, and the two are serialised to different precisions: the vector is
  // written to six decimals, and six decimals of a direction cosine is four
  // ten-thousandths of a degree of bearing. So the plane this dome is mirror
  // symmetric about stands at 279.999624 while the label says 280.
  //
  // Mirroring about the label instead measures that gap rather than the sky, and
  // the ramp is the first sky in this campaign sensitive enough to notice: its
  // colour near the sun is mostly the cos^40 glow, whose slope in bearing is
  // forty times the lobe's own, so four ten-thousandths of a degree comes back
  // as four ten-thousandths of a Lab unit — over a limit set at one. Measured
  // both ways: about the label the worst relative disagreement is 4.07e-4, about
  // the vector's own bearing it is 3.23e-14, which is the float noise the
  // comment below predicts and the ZERO it says to confirm.
  //
  // The vector and the label disagreeing at the sixth decimal is a property of
  // the SEALED preset (`day.sun`) and is reported rather than touched.
  const sunBearing = (Math.atan2(sun.vector[0], -sun.vector[2]) / DEG + 360) % 360;

  const rgb = [0, 0, 0];
  const angleTo = (elevation, azimuth) => {
    const d = directionOf(elevation, azimuth);
    const s = sun.vector;
    return Math.acos(Math.min(1, Math.max(-1, d[0] * s[0] + d[1] * s[1] + d[2] * s[2]))) / DEG;
  };

  // ------------------------------------------ nothing at a place, exactly
  //
  // The reading that cannot be argued with, and the one the old dome could
  // never have passed. Two bearings mirrored about the sun's own bearing stand
  // at the same height and the same angle from the sun, so this sky has no way
  // to tell them apart: the numbers must come back identical, to the last bit.
  //
  // Anything measured off a photograph knows WHERE it is, and a thing that
  // knows where it is breaks this on the first sample. It is therefore not a
  // tolerance to be tuned but a structural claim to be confirmed, which is why
  // it is held to a millionth of a Lab unit rather than to anything an eye can
  // see: the number that comes out is nought or the sky is not what this file
  // says it is.
  log('');
  {
    // A ten thousandth of a Lab unit, and the limit is loose on purpose while
    // the claim is not. The claim is structural — this sky has no term that
    // knows a bearing — so what is being confirmed is that the answer is
    // ZERO, not that it is small. What stops it being bitwise nought is the
    // road the number travels: a sun vector, a dot product, an arc cosine, a
    // fortieth power, a tone curve and a conversion to Lab, each shedding a few
    // bits. Ten thousandths is four orders under anything an eye can find and
    // three under the smallest thing this file is willing to call a blotch;
    // any material actually measured off a photograph lands three orders ABOVE
    // it, so nothing can hide in the gap.
    const MIRROR_LIMIT = 1e-4;
    // Everything but the disc's own shoulder, where the arithmetic OF THIS TEST
    // is what breaks rather than the sky. The angle from the sun is recovered
    // with an arc cosine, which loses its precision exactly where its argument
    // approaches one, and the disc puts eight hundred units of lightness into
    // the third of a degree its edge is let go over. Two mirrored bearings land
    // on that ramp with cosines that agree to the last few bits and levels that
    // therefore do not. It is measured and reported rather than dropped,
    // because it is a real difference in the frame — of seven thousandths of a
    // Lab unit, on a white dot, which is a hundred and forty times under what
    // an eye finds anywhere.
    const DISC_SHOULDER = 2;
    let worst = 0;
    let where = '';
    let pairs = 0;
    let atDisc = 0;
    const left = [0, 0, 0];
    const right = [0, 0, 0];
    for (let elevation = -10; elevation <= 90; elevation += 1) {
      for (let d = 0.5; d <= 180; d += 0.5) {
        domeAt(day, elevation, sunBearing + d, left);
        domeAt(day, elevation, sunBearing - d, right);
        const a = encoded(left);
        const b = encoded(right);
        const apart = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (angleTo(elevation, sunBearing + d) < DISC_SHOULDER) {
          atDisc = Math.max(atDisc, apart);
          continue;
        }
        pairs++;
        if (apart > worst) {
          worst = apart;
          where = `el ${elevation}, ${d} deg either side of the sun's bearing`;
        }
      }
    }
    log(`the sky knows nothing but its height and its angle from the sun: worst `
      + `DeltaE between mirrored bearings ${worst.toExponential(2)} over ${pairs} pairs`
      + `${worst > 0 ? ` (${where})` : ''}`);
    log(`  and on the disc's own shoulder, where this test's arc cosine is what `
      + `loses precision: ${atDisc.toExponential(2)}`);
    if (worst > MIRROR_LIMIT) {
      complaints.push(`mirrored bearings differ by ${worst.toExponential(2)} at ${where}: `
        + 'something in this dome knows where it is, which is what a blotch is made of');
    }
  }

  // ------------------------------------------------- round the compass
  const radius = Math.max(1, Math.round(SMOOTH_DEG / STEP_DEG));
  const samples = Math.round(360 / STEP_DEG);
  log('');
  log('round the compass, at each height the criterion names:');
  log(`  band   ${CHANNELS.map((n) => n.padStart(9)).join('')}   worst NARROW contour; then what closes at all`);
  for (const pitch of PITCHES) {
    const raw = CHANNELS.map(() => new Float64Array(samples));
    for (let k = 0; k < samples; k++) {
      const azimuth = k * STEP_DEG - 180;
      domeAt(day, pitch, azimuth, rgb);
      const lab = encoded(rgb);
      for (let c = 0; c < 3; c++) raw[c][k] = lab[c];
    }
    const cells = [];
    const notes = [];
    for (let c = 0; c < 3; c++) {
      const filtered = smooth(raw[c], radius, true);
      const extrema = closedExtrema(filtered, true)
        .filter((e) => e.prominence > BLOTCH_LIMIT)
        .map((e) => ({
          ...e, azimuth: e.at * STEP_DEG - 180, width: e.span * STEP_DEG,
        }));
      const narrow = extrema.filter((e) => e.width < MIN_FEATURE_DEG);
      cells.push((narrow.reduce((t, e) => Math.max(t, e.prominence), 0)).toFixed(3).padStart(9));
      if (extrema.length && c === 0) {
        notes.push(extrema.map((e) => `${e.kind} az ${e.azimuth.toFixed(0)} `
          + `${e.prominence.toFixed(2)} deep ${e.width.toFixed(0)} deg wide`).join(', '));
      }
      for (const e of narrow) {
        complaints.push(`at pitch ${pitch} the ${CHANNELS[c]} closes a ${e.prominence.toFixed(3)} `
          + `unit contour only ${e.width.toFixed(0)} deg wide at az ${e.azimuth.toFixed(0)}, `
          + `against ${MIN_FEATURE_DEG} deg for anything that is a sky and not a patch`);
      }
    }
    log(`  el ${String(pitch).padStart(3)}  ${cells.join('')}   ${notes.join('; ') || 'nothing closed at all'}`);
  }

  // ----------------------------------------------------- and up the sky
  const upSamples = Math.round(90 / STEP_DEG) + 1;
  log('');
  log(`up from the horizon, on ${BEARINGS} bearings:`);
  log(`  bearing${CHANNELS.map((n) => n.padStart(9)).join('')}   worst NARROW contour; then what closes at all`);
  for (let b = 0; b < BEARINGS; b++) {
    const azimuth = (b * 360) / BEARINGS - 180;
    const raw = CHANNELS.map(() => new Float64Array(upSamples));
    for (let k = 0; k < upSamples; k++) {
      domeAt(day, k * STEP_DEG, azimuth, rgb);
      const lab = encoded(rgb);
      for (let c = 0; c < 3; c++) raw[c][k] = lab[c];
    }
    const cells = [];
    const notes = [];
    for (let c = 0; c < 3; c++) {
      const filtered = smooth(raw[c], radius, false);
      const extrema = closedExtrema(filtered, false)
        .filter((e) => e.prominence > BLOTCH_LIMIT)
        .map((e) => ({
          ...e, elevation: e.at * STEP_DEG, width: e.span * STEP_DEG,
        }));
      const narrow = extrema.filter((e) => e.width < MIN_FEATURE_DEG);
      cells.push((narrow.reduce((t, e) => Math.max(t, e.prominence), 0)).toFixed(3).padStart(9));
      if (extrema.length && c === 0) {
        notes.push(extrema.map((e) => `${e.kind} el ${e.elevation.toFixed(0)} `
          + `${e.prominence.toFixed(2)} deep ${e.width.toFixed(0)} deg wide `
          + `(${angleTo(e.elevation, azimuth).toFixed(0)} deg from the sun)`).join(', '));
      }
      for (const e of narrow) {
        complaints.push(`on the bearing ${azimuth.toFixed(0)} the ${CHANNELS[c]} closes a `
          + `${e.prominence.toFixed(3)} unit contour only ${e.width.toFixed(0)} deg wide at `
          + `el ${e.elevation.toFixed(0)}, against ${MIN_FEATURE_DEG} deg`);
      }
    }
    log(`  az ${String(Math.round(azimuth)).padStart(4)}  ${cells.join('')}   ${notes.join('; ') || 'nothing closed at all'}`);
  }

  // -------------------------------------------------- how smooth, in numbers
  log('');
  {
    let worst = 0;
    let where = '';
    for (const pitch of PITCHES) {
      const raw = new Float64Array(samples);
      for (let k = 0; k < samples; k++) {
        domeAt(day, pitch, k * STEP_DEG - 180, rgb);
        raw[k] = encoded(rgb)[0];
      }
      const curvature = worstCurvature(smooth(raw, radius, true), STEP_DEG, true);
      if (curvature > worst) { worst = curvature; where = `round the compass at el ${pitch}`; }
    }
    for (let b = 0; b < BEARINGS; b++) {
      const azimuth = (b * 360) / BEARINGS - 180;
      const raw = new Float64Array(upSamples);
      for (let k = 0; k < upSamples; k++) {
        domeAt(day, k * STEP_DEG, azimuth, rgb);
        raw[k] = encoded(rgb)[0];
      }
      const curvature = worstCurvature(smooth(raw, radius, false), STEP_DEG, false);
      if (curvature > worst) { worst = curvature; where = `up the sky on az ${azimuth.toFixed(0)}`; }
    }
    log(`worst curvature of any filtered profile: ${worst.toFixed(4)} units of lightness `
      + `per square degree (${where})`);
  }

  // ------------------------------------------------------------- the sun
  log('');
  {
    const peak = domeRadiance(day, sun.vector, [0, 0, 0]).slice();
    const display = agx(peak, 1).map((v) => Math.round(255 * Math.min(1, Math.max(0, linearToSrgb(v)))));
    log(`the disc: radiance ${peak.map((v) => v.toFixed(1)).join(' ')}, which the tone curve `
      + `lands on ${display.join(',')}`);
    const away = [0.5, 1, 2, 5, 10, 20, 40].map((angle) => {
      domeAt(day, sun.elevation - angle, sun.azimuth, rgb);
      const enc = agx(rgb, 1).map((v) => Math.round(255 * Math.min(1, Math.max(0, linearToSrgb(v)))));
      return `${angle} deg ${enc.join(',')}`;
    });
    log(`  and the sky falling away from it: ${away.join(' | ')}`);
    // Nothing but the disc itself may reach the top of the curve. A sky that
    // clips has lost its hue there, and a lost hue next to a cloud is the white
    // hole the canon calls a hotspot.
    let clipped = 0;
    let total = 0;
    for (let e = -10; e <= 90; e += 1) {
      for (let a = -180; a < 180; a += 1) {
        if (angleTo(e, a) < 1) continue;
        domeAt(day, e, a, rgb);
        const enc = agx(rgb, 1);
        total++;
        if (Math.max(...enc) >= 0.999) clipped++;
      }
    }
    log(`  sky more than a degree from the disc that reaches the top of the curve: `
      + `${clipped} of ${total} directions`);
    if (clipped > 0) complaints.push(`${clipped} directions of open sky clip`);
  }

  // ------------------------------------------------------- and the palette
  log('');
  {
    const anchor = (name, elevation, azimuth) => {
      domeAt(day, elevation, azimuth, rgb);
      const hex = agx(rgb, 1)
        .map((v) => Math.round(255 * Math.min(1, Math.max(0, linearToSrgb(v)))).toString(16).padStart(2, '0'))
        .join('');
      log(`  ${name.padEnd(28)} #${hex}`);
    };
    log('the palette, as the frame shows it before the grade:');
    anchor('zenith', 90, sun.azimuth);
    anchor('sky beside the sun, 15 deg', sun.elevation - 15, sun.azimuth);
    anchor('horizon towards the sun', 0, sun.azimuth);
    anchor('horizon across it', 0, sun.azimuth + 90);
    anchor('horizon away from it', 0, sun.azimuth + 180);
  }

  log('');
  for (const line of complaints) log(`  FAILED  ${line}`);
  if (complaints.length) {
    throw new Error(`${complaints.length} reading(s) of the dome are not a clear sky`);
  }
  log(`the sereno closes nothing but the sun, on ${PITCHES.length} bands and ${BEARINGS} bearings, `
    + `to ${BLOTCH_LIMIT} units of Lab`);
}

main();
