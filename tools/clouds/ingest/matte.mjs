// Step two and three of the plate chain: lift the cloud off the sky, and cut
// the plate into one piece per body.
//
//   node tools/clouds/ingest/matte.mjs <plate.png> [...] \
//        --roster assets-src/clouds/plates.json --out <dir> [--preview]
//
// One directory of pieces goes out, each one a coverage and a premultiplied
// colour in linear light at full precision, with a head beside it saying where
// in the sky it was photographed and how large it is. Nothing is quantised
// here: eight bits is a decision the packing takes once, for the whole atlas,
// against one level scale, and taking it twice would cost the fringe twice.
//
// The plate's own numbers — how wide a frame it spans, where the sun was — are
// not measurable from the pixels and are not guessed: they come from the roster
// in assets-src/clouds/plates.json, which is the one file that has to be
// checked when the real sources land.

import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { basename, extname, join } from 'node:path';
import { writeCleanPng } from '../../grade/lib/png.mjs';
import { linearToSrgb } from '../../grade/lib/color.mjs';
import { premultiplicationOf, readPlate } from './lib/plate.mjs';
import { fitSkyField } from './lib/sky-field.mjs';
import {
  blur, reconstructShoulder, solveMatte, veilShare,
} from './lib/matte.mjs';
import {
  cutPiece, plateFrame, separate, sunInPieceFrame, windowOfBody,
} from './lib/pieces.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 ? d : argv[i + 1];
};
const flag = (k) => argv.includes(`--${k}`);
const OUT = opt('out', null);
const ROSTER = opt('roster', `${ROOT}assets-src/clouds/plates.json`);
const files = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!files.length || !OUT) {
  console.error('usage: matte.mjs <plate.png> [...] --out <dir> [--roster f] [--preview]');
  process.exit(1);
}
const roster = existsSync(ROSTER) ? JSON.parse(readFileSync(ROSTER, 'utf8')) : { plates: [] };
const defaults = roster.defaults || {};
mkdirSync(OUT, { recursive: true });

const round = (v, n = 4) => Number(v.toFixed(n));

/** The background a window stands over, averaged. */
function skyOver(sky, box) {
  const s = [0, 0, 0];
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = box[1]; y < box[3]; y += 4) {
    for (let x = box[0]; x < box[2]; x += 4) {
      sky.at(x + 0.5, y + 0.5, s);
      for (let c = 0; c < 3; c++) sum[c] += s[c];
      n++;
    }
  }
  return sum.map((v) => v / Math.max(1, n));
}

// How many rows the plate's own sky is reported over a window, and why the
// number is small.
//
// What it is for: a piece is brought into the world by the ratio of this
// world's sky to the plate's own, and both of those FALL with height — a real
// sky and a photograph of one. The packing can only take that ratio once, at
// one height, so what is left over is the disagreement between the two falls,
// and correcting the frame for the dome's fall without dividing by the plate's
// own counts the same thing twice. Measured: doing exactly that put a bank's
// base at a Weber contrast of 0.46 where the reference reads 0.22 and welded
// four bodies into one.
//
// Sixteen rows, because the surface it samples is a polynomial of degree two
// or three: sixteen samples of a quadratic are fifteen more than it needs, and
// what they cost is a line in the manifest.
const SKY_ROWS = 16;

/**
 * The plate's own background down a window, as a share of that window's mean.
 *
 * Stated as a ratio rather than as a colour so that whatever reads it cannot
 * accidentally use it as a level: the level is skyColour, taken over the whole
 * window, and this says only how the sky the piece was lifted off leaned from
 * its top to its bottom.
 */
function skyRows(sky, box, rows = SKY_ROWS) {
  const s = [0, 0, 0];
  const out = [];
  for (let r = 0; r < rows; r++) {
    const y = box[1] + (box[3] - box[1]) * (r + 0.5) / rows;
    let sum = 0;
    let n = 0;
    for (let x = box[0]; x < box[2]; x += 4) {
      sky.at(x + 0.5, y, s);
      sum += 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
      n++;
    }
    out.push(sum / Math.max(1, n));
  }
  const mean = out.reduce((t, v) => t + v, 0) / out.length;
  return out.map((v) => v / Math.max(1e-9, mean));
}

/**
 * How much light a plate carries where its own matte says there is nothing.
 *
 * The one reading that tells a premultiplied plate under a hard matte from a
 * plate whose matte is its own: under either convention a texel at coverage
 * nought should be black, and on this roster between a quarter and nine tenths
 * of them are not. Printed for every plate, whether or not the shoulder is
 * rebuilt, so the roster entry that asks for the rebuild can be checked against
 * the plate instead of believed.
 */
function lightOutsideMatte(lin, alpha, width, height) {
  let zero = 0;
  let lit = 0;
  let sum = 0;
  for (let i = 0; i < width * height; i++) {
    if (alpha[i] > 0) continue;
    zero++;
    const c = Math.max(lin[i * 3], lin[i * 3 + 1], lin[i * 3 + 2]);
    if (c > 2 / 255) { lit++; sum += c; }
  }
  return { share: zero ? lit / zero : 0, mean: lit ? sum / lit : 0, zero };
}

/** The coverage a piece carries in total, in texels. */
const coverageOf = (alpha) => alpha.reduce((t, v) => t + v, 0);

/** What each edge of a window carries, in the eight bits the atlas stores. */
const edgeReport = (each) => Object.entries(each)
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k} ${(v * 255).toFixed(2)}/255`)
  .join(', ');

for (const file of files) {
  const stem = basename(file, extname(file));
  const spec = (roster.plates || []).find((p) => p.file === basename(file) || p.id === stem)
    || { id: stem };
  const conf = { ...defaults, ...spec };
  const plate = await readPlate(file);
  const { width, height } = plate;
  const spanDeg = Number(opt('span', conf.spanDeg ?? 65));
  const degree = Number(opt('degree', conf.degree ?? 2));
  const floor = Number(opt('floor', conf.floor ?? 1.5));
  const smooth = Number(opt('smooth', conf.smooth ?? 1));
  // One display level of step where a window ends, expressed as coverage: the
  // material's own contrast against its sky is about fifty levels, so a
  // fiftieth of coverage is a level.
  // What an edge may carry before the body is called cut by the frame and
  // thrown away, and how wide the band is that closes the ones under it.
  const ceiling = Number(opt('edgeCeiling', conf.edgeCeiling ?? 0.12));
  const quiet = Number(opt('quiet', conf.quiet ?? 0.5 / 255));
  const axisAz = conf.azimuth ?? 0;
  const axisEl = conf.elevation ?? 0;
  const sunAz = axisAz + (conf.sunAzimuthOffset ?? 0);
  const sunEl = conf.sunElevation ?? 32;

  // WHEN THE SOURCE BRINGS ITS OWN COVERAGE, NOTHING HERE ESTIMATES ONE.
  //
  // Everything below this point — the surface fitted to the background, the
  // knee at the plate's own noise, the topological closing of the cores — exists
  // to answer one question: how much of each texel is cloud. A source delivered
  // with a true alpha has already answered it, exactly, and re-deriving it from
  // pixels that no longer have a sky behind them would be replacing a
  // measurement with a guess. So the matte is taken as given, at full
  // precision, with no threshold and no knee anywhere near it.
  //
  // What such a source CANNOT bring is the sky it was shot against, because
  // there is no sky in it — and that is the one number the packing calibrates a
  // plate's level by. It has to come from the roster, and if it does not, this
  // says so and stops: inventing an exposure is exactly the failure the packing
  // is written to prevent.
  const lin = blur(plate.lin, width, height, 3, smooth);
  const given = plate.alpha && !flag('rematte');
  let matte;
  let sky;
  if (given) {
    const conv = premultiplicationOf(plate.lin, plate.alpha, width, height);
    const skyColour = conf.skyColour || (roster.world || {}).plateSky;
    if (!skyColour) {
      console.error(`${file} carries its own coverage but the roster states no skyColour for `
        + `"${conf.id}": a plate with a true alpha has no background left to measure, and the `
        + 'level it is brought into the world at is calibrated against that background. State '
        + 'it in assets-src/clouds/plates.json (linear rgb) and run again.');
      process.exitCode = 1;
      continue;
    }
    // PREMULTIPLIED here, once, because that is what the rest of the chain and
    // the frame both are.
    //
    // The other branch of this file writes C − (1 − a)·S, which IS the cloud's
    // colour already multiplied by its own coverage; pack.mjs box averages the
    // colour and the coverage together and writes the pair straight into the
    // atlas; and src/world/clouds.js draws that atlas with
    // `premultipliedAlpha: true`. There is one convention here and it is this
    // one. A source that arrives as colour over black already carries it; one
    // that arrives with the colour left alone behind the mask does not, and is
    // multiplied by its coverage exactly once.
    //
    // WHAT THE OTHER WAY ROUND COST, measured on the delivery this line was
    // written for. The straight colour went into the atlas as if it were
    // premultiplied, so every texel whose coverage was under its own material
    // wrote the WHOLE material's light instead of its share of it. The clamp in
    // the fragment — min(texel.rgb, vec3(cover)), a7fec1d — had been holding
    // that down since, and it is a per-channel clamp: where it bit all three
    // channels the fragment wrote NEUTRAL GREY at the coverage, whatever colour
    // the cloud was. Counted over the whole atlas the frame drew x1.18 the light
    // the material has; on the high veils x3.81, x2.35 and x1.92, with a fifth
    // of their texels painted grey. Neutral grey laid over a zenith at r/g 0.30
    // is tan, and that is the brown crust under the cumulus overhead and the
    // marble veining of the veils, both of them, from one line.
    //
    // AND WHY THIS ROSTER TAKES A THIRD ROAD, WHICH IS NEITHER OF THE TWO.
    //
    // The question above — does the colour ever stand above the coverage — is
    // the only one the pixels can answer about a convention, and on these
    // fifteen plates it answers "straight" correctly and uselessly. They are a
    // cloud drawn OVER BLACK with a HARD MATTE laid on top of it: the colour
    // carries a shoulder the matte is already nought across. Multiplying the
    // colour by that matte is right in the body, where the matte is one, and in
    // the fringe it multiplies the shoulder by zero. What comes out is the
    // material two gates in a row called a line instead of air.
    //
    // So the coverage is REBUILT from the colour that kept it — see
    // reconstructShoulder in lib/matte.mjs for the model and for what it cannot
    // do — and the colour is then kept as it stands, because a premultiplied
    // plate under a coverage read out of its own premultiplication is already
    // the pair this chain writes.
    //
    // The road is taken only where the plate says to take it: `shoulderFromColour`
    // in the roster, and the run prints how much light stands outside the matte
    // so that the entry can be checked against the plate rather than believed.
    const outside = lightOutsideMatte(plate.lin, plate.alpha, width, height);
    const rebuild = conf.shoulderFromColour ?? false;
    const rgb = new Float32Array(width * height * 3);
    let alphaOut = plate.alpha;
    let rec = null;
    if (rebuild) {
      const reachDeg = Number(opt('veilReach', conf.veilReachDeg ?? 2.2));
      rec = reconstructShoulder(plate.lin, plate.alpha, width, height, {
        knee: Number(opt('veilKnee', conf.veilKnee ?? 3 / 255)),
        gamma: Number(opt('veilGamma', conf.veilGamma ?? 1)),
        // Stated in DEGREES of this plate's sky and turned into texels here, so
        // that the same roster line means the same width of shoulder whatever
        // resolution and whatever lens a source arrives at.
        reach: reachDeg > 0 ? reachDeg * (width / spanDeg) : Infinity,
      });
      alphaOut = rec.alpha;
      for (let i = 0; i < width * height * 3; i++) rgb[i] = plate.lin[i];
    } else {
      for (let i = 0; i < width * height; i++) {
        const a = plate.alpha[i];
        const s = conv.premultiplied ? 1 : a;
        for (let c = 0; c < 3; c++) rgb[i * 3 + c] = a > 0 ? plate.lin[i * 3 + c] * s : 0;
      }
    }
    matte = {
      alpha: alphaOut, rgb, material: skyColour, interior: 0, held: 0, residual: 0, noise: 0, knee: 0,
    };
    sky = { at: (x, y, out) => { for (let c = 0; c < 3; c++) out[c] = skyColour[c]; }, skyBlocks: 0, blocks: 0 };
    const partial = alphaOut.reduce((t, a) => t + (a > 0 && a < 1 ? 1 : 0), 0);
    process.stdout.write(`\n${file}\n  ALPHA GIVEN: no matting. `
      + `${rebuild ? 'premultiplied over black under a hard matte, SHOULDER REBUILT from the colour'
        : (conv.premultiplied ? 'premultiplied over black, kept as it is'
          : 'straight colour behind the mask, multiplied by its own coverage')} `
      + `(${conv.above} of ${conv.tested} fringe texels stand over their own coverage)\n`
      + `  light outside the matte: ${(100 * outside.share).toFixed(1)}% of the texels at `
      + `coverage nought carry colour, mean ${outside.mean.toFixed(3)} linear\n`);
    if (rec) {
      process.stdout.write(`  shoulder: +${(100 * rec.added).toFixed(2)} points of coverage over `
        + `the frame, ${(100 * rec.outside).toFixed(1)}% of it where the matte had none; `
        + `material reference ${rec.ref.toFixed(3)} linear\n`
        + `  veil of the plate ${(100 * veilShare(plate.alpha).share).toFixed(1)}% before, `
        + `${(100 * veilShare(alphaOut).share).toFixed(1)}% after\n`);
    }
    process.stdout.write(`  ${(100 * partial / (width * height)).toFixed(1)}% of the frame partly `
      + `covered; sky from the roster ${skyColour.map((v) => v.toFixed(4)).join('/')}\n`);
  } else {
    sky = fitSkyField(lin, width, height, { degree });
    matte = solveMatte(lin, width, height, sky, {
      floor, erode: Number(opt('erode', conf.erode ?? Math.max(4, Math.round(width / 128)))),
    });
  }
  const whole = veilShare(matte.alpha);

  if (!given) process.stdout.write(`\n${file}\n`);
  process.stdout.write(`  ${width}x${height}, ${spanDeg} deg across, sun at `
    + `${sunAz.toFixed(1)}/${sunEl.toFixed(1)} behind the mass, smoothed by ${smooth} texel\n`);
  if (!given) {
    process.stdout.write(`  sky: degree ${degree}, ${sky.skyBlocks} of ${sky.blocks} blocks `
      + `certainly sky\n`);
    process.stdout.write(`  material ${matte.material.map((v) => v.toFixed(3)).join('/')}; `
      + `${(100 * matte.interior / (width * height)).toFixed(1)}% of the plate is behind cloud `
      + `on topological grounds, ${(100 * matte.held / (width * height)).toFixed(1)}% held there\n`);
    process.stdout.write(`  model residual ${(matte.residual * 100).toFixed(2)}% of the sky; `
      + `coverage noise ${(matte.noise * 255).toFixed(2)}/255, knee at `
      + `${(matte.knee * 255).toFixed(2)}/255\n`);
  }
  process.stdout.write(`  coverage: ${(100 * whole.body / (width * height)).toFixed(1)}% of the `
    + `plate carries cloud, veil ${(100 * whole.share).toFixed(1)}% of it\n`);

  // The dilation is stated in DEGREES of sky and turned into texels here, so
  // that the same roster entry means the same thing whatever resolution the
  // source arrives at.
  const perDeg = width / spanDeg;
  const dilate = Math.max(1, Math.round((conf.dilateDeg ?? 0.18) * perDeg));
  const minSolid = Math.max(1, Math.round((conf.minSolidDeg ?? 0.6) * perDeg));
  // How much cloud a body has to be, stated as the side of the square of solid
  // coverage it is worth: a degree and a half of sky filled to the brim. It is
  // an amount and not a size, so a wide faint wisp and a small dense lump are
  // weighed on the same scale.
  const minMass = ((conf.minBodyDeg ?? 1.5) * perDeg) ** 2;
  const { labels, count, core } = separate(matte.alpha, width, height, {
    dilate, live: conf.coreAlpha ?? 0.05, minMass,
  });

  const frame = plateFrame({
    width, height, spanDeg, azimuth: axisAz, elevation: axisEl,
  });
  const dir = join(OUT, conf.id);
  mkdirSync(dir, { recursive: true });

  const kept = [];
  const dropped = [];
  for (let label = 1; label <= count; label++) {
    const win = windowOfBody(matte.alpha, labels, core, width, height, label, {
      reach: Math.round((conf.reachDeg ?? 8) * perDeg),
    });
    if (win.texels === 0) continue;
    const w = win.box[2] - win.box[0];
    const h = win.box[3] - win.box[1];
    if (w < minSolid || h < minSolid) {
      dropped.push({ label, why: `${w}x${h} px, under the ${minSolid} px a body has to be` });
      continue;
    }
    // A BODY THE PHOTOGRAPH CUT. Its window reached the edge of the plate with
    // coverage still standing on it, so the silhouette there is not the
    // cloud's, it is the frame's. Feathering it would only draw the same
    // straight line more softly — this is the defect the whole sky was rebuilt
    // to be rid of.
    //
    // AND THE RULE IS WRITTEN IN DISPLAY LEVELS, NOT IN ZEROES. What a cut
    // costs the frame is the step it makes where it ends, and that step is the
    // coverage there times the difference between cloud and sky — about fifty
    // levels in this material. So an edge carrying a hundredth of coverage
    // makes half a level, under the dither the composite already adds and
    // under anything an eye can find; an edge carrying a third makes fifteen,
    // which is the bite the thirteen gates were spent on. The ceiling is set
    // where the step reaches one level, every piece states what its own edges
    // carry, and nothing is quietly rounded away.
    if (win.border > ceiling) {
      dropped.push({
        label,
        why: `cut by the edge of the plate: ${edgeReport(win.each)}, against `
          + `${(ceiling * 255).toFixed(1)}/255 allowed`,
      });
      continue;
    }
    const edges = Object.fromEntries(Object.entries(win.each)
      .map(([k, v]) => [k, v > quiet]));
    const piece = cutPiece(frame, win.box, matte.alpha, matte.rgb, labels, label, {
      fade: Object.values(edges).some(Boolean)
        ? Math.round((conf.fadeDeg ?? 4) * perDeg) : 0,
      edges,
    });
    const share = veilShare(piece.alpha);
    const id = `${conf.id}-${kept.length + 1}`;
    const head = {
      id,
      plate: conf.id,
      kind: conf.kind || 'library',
      width: piece.width,
      height: piece.height,
      azimuth: round(piece.azimuth, 3),
      elevation: round(piece.elevation, 3),
      halfU: round(piece.halfU, 6),
      halfV: round(piece.halfV, 6),
      spanU: round(2 * Math.atan(piece.halfU) * 180 / Math.PI, 3),
      spanV: round(2 * Math.atan(piece.halfV) * 180 / Math.PI, 3),
      degPerTexel: round(piece.degPerTexel, 6),
      // The sun as it stood in THIS piece's own frame, which is what the
      // runtime divides by when the piece is asked to stand somewhere else.
      sunSource: sunInPieceFrame(piece.azimuth, piece.elevation, sunAz, sunEl)
        .map((v) => round(v, 5)),
      // The background this piece was lifted off, averaged over its own window.
      // Nothing at runtime reads it; it is what lets a later measurement ask
      // how much of that background the fringe is still carrying, which is the
      // one question a de-contamination has to be able to answer.
      skyColour: skyOver(sky, win.box).map((v) => round(v, 6)),
      // And how that background leaned from the top of the window to its
      // bottom, as a share of its own mean. THIS is what a calibration against
      // the sky a piece stands in front of has to divide by: see skyRows.
      skyRows: skyRows(sky, win.box).map((v) => round(v, 5)),
      borderAlpha: round(piece.borderAlpha, 6),
      borderPeak: round(piece.borderPeak, 6),
      // Which edges of the plate's own window the body was still standing on,
      // so that a piece kept with a wisp at its edge says so for the rest of
      // its life rather than only in the run that made it.
      windowEdges: Object.fromEntries(Object.entries(win.each)
        .map(([k, v]) => [k, round(v, 6)])),
      closed: win.closed,
      // What the closing band took off each edge, as a share of the piece's
      // whole coverage: nought everywhere the plate closed the body by itself.
      fadeBandCover: Object.fromEntries(Object.entries(piece.faded)
        .map(([k, v]) => [k, round(v / Math.max(1e-9, coverageOf(piece.alpha)), 5)])),
      veilShare: round(share.share, 4),
      window: win.box,
    };
    const body = Buffer.alloc((piece.width * piece.height * 4) * 4);
    Buffer.from(piece.alpha.buffer).copy(body, 0);
    Buffer.from(piece.rgb.buffer).copy(body, piece.width * piece.height * 4);
    writeFileSync(join(dir, `${id}.piece`), body);
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(head, null, 2));
    kept.push(head);
  }

  process.stdout.write(`  bodies: ${count} found, ${kept.length} kept, `
    + `${dropped.length} dropped\n`);
  for (const k of kept) {
    process.stdout.write(`    ${k.id}  ${k.width}x${k.height}  `
      + `${k.spanU.toFixed(1)}x${k.spanV.toFixed(1)} deg  az ${k.azimuth.toFixed(1)} `
      + `el ${k.elevation.toFixed(1)}  veil ${(100 * k.veilShare).toFixed(1)}%  `
      + `border ${(k.borderAlpha * 255).toFixed(2)}/255\n`);
  }
  for (const d of dropped) process.stdout.write(`    dropped: ${d.why}\n`);
  if (conf.bodies !== undefined && conf.bodies !== kept.length) {
    process.stdout.write(`    NOTE the roster expects ${conf.bodies} body(ies) from this `
      + `plate and the separation kept ${kept.length}: check the dilation before packing\n`);
  }

  if (flag('preview')) {
    // The matte over black and the coverage beside it. Nothing reads this; it
    // is what an eye looks at when a number and a plate disagree.
    const view = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      for (let c = 0; c < 3; c++) {
        view[i * 3 + c] = Math.round(255 * linearToSrgb(
          Math.max(0, Math.min(1, matte.rgb[i * 3 + c] / 1.35)),
        ));
      }
    }
    await writeCleanPng(view, { width, height, channels: 3 }, join(OUT, `${conf.id}-matte.png`));
    const cover = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      const v = Math.round(255 * Math.max(0, Math.min(1, matte.alpha[i])));
      cover[i * 3] = v; cover[i * 3 + 1] = v; cover[i * 3 + 2] = v;
    }
    await writeCleanPng(cover, { width, height, channels: 3 }, join(OUT, `${conf.id}-cover.png`));
  }
}
