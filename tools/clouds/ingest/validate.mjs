// Step five: what the chain is worth, in numbers.
//
//   node tools/clouds/ingest/validate.mjs --plates <dir> [--truth <dir>] \
//        [--pieces <dir>] [--atlas <dir>] [--out <dir>]
//
// Two things are measured and they answer different questions.
//
// AGAINST GROUND TRUTH, on the synthetic plates, whose coverage was decided
// before the plate existed: how far the recovered coverage is from the one that
// was composited, how much of the veil survives, and what the recovered colour
// does when it is laid over a sky of a completely different colour. That last
// is the de-contamination test, and it is the one a matte usually fails: a
// fringe that kept a share of its original background looks right over that
// background and shows a blue halo over anything else.
//
// AND WITHOUT GROUND TRUTH, on the real plates, where there is none and never
// will be. The same contamination question is asked of a piece directly: the
// colour recovered in the fringe is decomposed into the body's own material and
// the ORIGINAL SKY, in least squares, and what comes back is how much of a
// sky's worth of blue each fringe texel is still carrying. Nought is the answer
// the unpremultiply is supposed to give, and the measurement does not need to
// know what the right answer was to say how far from nought it is.

import {
  existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { readPlate } from './lib/plate.mjs';
import { fitSkyField } from './lib/sky-field.mjs';
import { blur, solveMatte, veilShare } from './lib/matte.mjs';
import { linearToSrgb } from '../../grade/lib/color.mjs';
import { writeCleanPng } from '../../grade/lib/png.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 ? d : argv[i + 1];
};
const PLATES = opt('plates', null);
const TRUTH = opt('truth', null);
const PIECES = opt('pieces', null);
const ATLAS = opt('atlas', null);
const OUT = opt('out', null);
const ROSTER = opt('roster', `${ROOT}assets-src/clouds/plates.json`);
const roster = existsSync(ROSTER) ? JSON.parse(readFileSync(ROSTER, 'utf8')) : { plates: [] };
const defaults = roster.defaults || {};
if (OUT) mkdirSync(OUT, { recursive: true });

const pct = (v) => `${(100 * v).toFixed(2)}%`;
const lev = (v) => `${(255 * v).toFixed(2)}/255`;

// A sky the plates were never shot against, for the contamination test. Warm,
// dark and with almost no blue in it: whatever of the original background a
// fringe kept shows up over this at once, which is the whole point of choosing
// it rather than another blue.
const OTHER_SKY = [0.42, 0.17, 0.045];

/** How blue a colour is, as a share of its own total. */
const blueness = (c) => c[2] / Math.max(1e-6, c[0] + c[1] + c[2]);

/**
 * HOW MUCH OF ITS ORIGINAL SKY A PIECE'S FRINGE IS STILL CARRYING.
 *
 * On a plate with no ground truth the question cannot be asked by comparison,
 * so it is asked by chromaticity. Contamination has one signature and only one:
 * the fringe comes out BLUER than the body, because what leaked into it is the
 * blue that was behind it. So the recovered colour of the body and the
 * recovered colour of the fringe are compared on the one axis the sky and the
 * cloud differ on, and the distance is stated as a share of the whole distance
 * between the body's blue and the sky's:
 *
 *   nought — the fringe is the same material as the body, which is what an
 *            unpremultiply against the background is supposed to leave;
 *   one    — the fringe is the sky, which is what MASKING leaves.
 *
 * AND THE MEASURE IS SHOWN FINDING THE DEFECT BEFORE IT IS BELIEVED. The
 * control is the same piece with the matte replaced by a mask — premultiplied
 * colour taken as the plate's own colour times the coverage, which is what
 * every naive extraction does and what leaves the whole background in the
 * fringe. A number that cannot tell those two apart is a number that has
 * nothing to say about the real one.
 */
function skyInFringe(alpha, rgb, skyColour, { masked = false } = {}) {
  const body = [0, 0, 0];
  const fringe = [0, 0, 0];
  let bodyMass = 0;
  let fringeMass = 0;
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i];
    if (a < 0.02) continue;
    for (let c = 0; c < 3; c++) {
      // The recovered colour of the cloud at this texel. Masking would have
      // left the plate's own colour there, which is the cloud plus whatever
      // sky the coverage did not cover.
      const value = masked
        ? rgb[i * 3 + c] / a + (1 - a) * skyColour[c] : rgb[i * 3 + c] / a;
      if (a > 0.85) body[c] += value * a;
      else if (a > 0.05 && a < 0.35) fringe[c] += value * a;
    }
    if (a > 0.85) bodyMass += a;
    else if (a > 0.05 && a < 0.35) fringeMass += a;
  }
  if (!bodyMass || !fringeMass) return null;
  const b = blueness(body.map((v) => v / bodyMass));
  const f = blueness(fringe.map((v) => v / fringeMass));
  const s = blueness(skyColour);
  return { body: b, fringe: f, sky: s, share: (f - b) / Math.max(1e-6, s - b) };
}

// -------------------------------------------------- against what was composited

if (PLATES && TRUTH) {
  process.stdout.write('\nTHE CHAIN AGAINST PLATES WHOSE COVERAGE IS KNOWN\n');
  for (const name of readdirSync(TRUTH).filter((f) => f.endsWith('.truth')).sort()) {
    const id = basename(name, '.truth');
    const plateFile = join(PLATES, `${id}.png`);
    if (!existsSync(plateFile)) continue;
    const spec = (roster.plates || []).find((p) => p.id === id) || {};
    const conf = { ...defaults, ...spec };
    const plate = await readPlate(plateFile);
    const { width, height } = plate;
    const N = width * height;
    const body = readFileSync(join(TRUTH, name));
    const truthAlpha = new Float32Array(body.buffer, body.byteOffset, N);
    const truthRgb = new Float32Array(body.buffer, body.byteOffset + N * 4, N * 3);
    const truthSky = new Float32Array(body.buffer, body.byteOffset + N * 16, N * 3);

    const lin = blur(plate.lin, width, height, 3, conf.smooth ?? 1);
    const sky = fitSkyField(lin, width, height, { degree: conf.degree ?? 2 });
    const settings = {
      floor: conf.floor ?? 1.5, erode: Math.max(4, Math.round(width / 128)),
    };
    const matte = solveMatte(lin, width, height, sky, settings);
    // And the same chain with the topological hold off, because that step is
    // the one thing here that ASSERTS rather than measures. On a real cumulus
    // it is right by physics — a body a kilometre thick passes no light — and
    // on these plates it is not, because their bodies were composited at six
    // and eight tenths of coverage in the middle. Reporting both is the only
    // honest way to say what it buys and what it costs.
    const loose = solveMatte(lin, width, height, sky, { ...settings, hold: false });

    // The background, against the one that was actually used.
    let skyErr = 0; let skyWorst = 0;
    const s = [0, 0, 0];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        sky.at(x + 0.5, y + 0.5, s);
        for (let c = 0; c < 3; c++) {
          const e = Math.abs(s[c] - truthSky[i * 3 + c]) / Math.max(1e-6, truthSky[i * 3 + c]);
          skyErr += e;
          if (e > skyWorst) skyWorst = e;
        }
      }
    }
    skyErr /= N * 3;

    // The coverage, everywhere and then where it matters most.
    let sum = 0; let worst = 0; let worstAt = null;
    let veilSum = 0; let veilCount = 0;
    let skySum = 0; let skyCount = 0;
    for (let i = 0; i < N; i++) {
      const e = Math.abs(matte.alpha[i] - truthAlpha[i]);
      sum += e;
      if (e > worst) { worst = e; worstAt = i; }
      if (truthAlpha[i] > 3 / 255 && truthAlpha[i] < 0.5) { veilSum += e; veilCount++; }
      if (truthAlpha[i] <= 3 / 255) { skySum += e; skyCount++; }
    }

    // And what the colour does over a sky it never saw.
    let colourErr = 0; let colourWorst = 0;
    let fringe = 0;
    for (let i = 0; i < N; i++) {
      if (truthAlpha[i] <= 3 / 255 && matte.alpha[i] <= 3 / 255) continue;
      fringe++;
      for (let c = 0; c < 3; c++) {
        const got = matte.rgb[i * 3 + c] + (1 - matte.alpha[i]) * OTHER_SKY[c];
        const want = truthRgb[i * 3 + c] + (1 - truthAlpha[i]) * OTHER_SKY[c];
        const e = Math.abs(linearToSrgb(Math.max(0, Math.min(1, got)))
          - linearToSrgb(Math.max(0, Math.min(1, want))));
        colourErr += e;
        if (e > colourWorst) colourWorst = e;
      }
    }
    colourErr /= Math.max(1, fringe * 3);

    let looseSum = 0; let looseWorst = 0;
    for (let i = 0; i < N; i++) {
      const e = Math.abs(loose.alpha[i] - truthAlpha[i]);
      looseSum += e;
      if (e > looseWorst) looseWorst = e;
    }
    const gotVeil = veilShare(matte.alpha);
    const looseVeil = veilShare(loose.alpha);
    const wantVeil = veilShare(truthAlpha);
    process.stdout.write(`\n  ${id}  ${width}x${height}\n`);
    process.stdout.write(`    background: mean ${pct(skyErr)} of the sky it was, worst `
      + `${pct(skyWorst)}\n`);
    process.stdout.write(`    coverage:   mean ${lev(sum / N)}, worst ${lev(worst)} at `
      + `(${worstAt % width}, ${Math.floor(worstAt / width)})\n`);
    process.stdout.write(`                over the veil ${lev(veilSum / Math.max(1, veilCount))}, `
      + `over empty sky ${lev(skySum / Math.max(1, skyCount))}\n`);
    process.stdout.write(`                with the opaque hold off: mean ${lev(looseSum / N)}, `
      + `worst ${lev(looseWorst)}\n`);
    process.stdout.write(`    veil:       ${pct(gotVeil.share)} of the cloud under half `
      + `thickness against ${pct(wantVeil.share)} composited `
      + `(${pct(looseVeil.share)} with the hold off)\n`);
    process.stdout.write(`    over a sky it never saw: mean ${lev(colourErr)}, `
      + `worst ${lev(colourWorst)} on ${fringe} texel(s)\n`);

    if (OUT) {
      const view = Buffer.alloc(width * height * 3);
      for (let i = 0; i < N; i++) {
        const e = Math.min(1, Math.abs(matte.alpha[i] - truthAlpha[i]) * 8);
        view[i * 3] = Math.round(255 * e);
        view[i * 3 + 1] = Math.round(255 * Math.min(1, truthAlpha[i]) * (1 - e));
        view[i * 3 + 2] = 0;
      }
      await writeCleanPng(view, { width, height, channels: 3 }, join(OUT, `${id}-alpha-error.png`));
    }
  }
}

// ------------------------------------------------ and on pieces with no truth

if (PIECES) {
  process.stdout.write('\nEVERY PIECE, AND WHAT ITS OWN NUMBERS SAY\n');
  process.stdout.write('  piece            size        span deg    veil   border mean / peak    '
    + 'sky in the fringe (control)\n');
  const rows = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (!name.endsWith('.json')) { if (!name.includes('.')) walk(path); continue; }
      const head = JSON.parse(readFileSync(path, 'utf8'));
      if (!head.width) continue;
      const raw = readFileSync(join(dir, `${basename(name, '.json')}.piece`));
      const n = head.width * head.height;
      const alpha = new Float32Array(raw.buffer, raw.byteOffset, n);
      const rgb = new Float32Array(raw.buffer, raw.byteOffset + n * 4, n * 3);
      const sky = head.skyColour || [0.08, 0.20, 0.42];
      const clean = skyInFringe(alpha, rgb, sky);
      const masked = skyInFringe(alpha, rgb, sky, { masked: true });
      const share = veilShare(alpha);
      rows.push({
        id: head.id,
        line: `  ${head.id.padEnd(16)} ${`${head.width}x${head.height}`.padEnd(11)} `
          + `${head.spanU.toFixed(1)}x${head.spanV.toFixed(1)}`.padEnd(12)
          + `${(100 * share.share).toFixed(1)}%`.padStart(6) + '  '
          + `${lev(head.borderAlpha)} / ${lev(head.borderPeak)}`.padStart(19) + '   '
          + (clean ? `${pct(clean.share)}` : 'no body').padStart(8)
          + (masked ? ` (${pct(masked.share)})` : ''),
      });
    }
  };
  walk(PIECES);
  for (const r of rows.sort((a, b) => a.id.localeCompare(b.id))) {
    process.stdout.write(`${r.line}\n`);
  }
}

// ------------------------------------------------- and the atlas it all lands in

if (ATLAS) {
  const manifest = JSON.parse(readFileSync(join(ATLAS, 'clouds.json'), 'utf8'));
  const png = join(ATLAS, 'cloud-sprites.png');
  const { inspectPng } = await import('../../grade/check-png.mjs');
  const info = inspectPng(png);
  process.stdout.write(`\nTHE ATLAS\n  ${info.header.width}x${info.header.height}, `
    + `${(info.bytes / 1024).toFixed(0)} KiB, `
    + `${info.ancillary.length ? `FAIL carries ${info.ancillary.map((c) => c.type).join(' ')}`
      : 'no ancillary chunk'}\n`);
  process.stdout.write(`  ${manifest.tiles.length} tile(s) from ${manifest.counts.plates} `
    + `plate(s), ${manifest.placements.length} placement(s), one texel is `
    + `${manifest.sampling.texelDeg} deg\n`);
  const worst = manifest.tiles.reduce((a, t) => (t.borderAlpha > a.borderAlpha ? t : a),
    manifest.tiles[0]);
  process.stdout.write(`  worst border in the atlas: ${worst.id} at ${lev(worst.borderAlpha)}\n`);
  if (OUT) {
    writeFileSync(join(OUT, 'atlas-report.json'), JSON.stringify({
      atlas: manifest.atlas,
      bytes: info.bytes,
      tiles: manifest.tiles.map((t) => ({
        id: t.id,
        rect: t.rect,
        spanU: Number((2 * Math.atan(t.halfU) * 180 / Math.PI).toFixed(2)),
        spanV: Number((2 * Math.atan(t.halfV) * 180 / Math.PI).toFixed(2)),
        borderAlpha: t.borderAlpha,
        areaRatio: t.areaRatio,
      })),
    }, null, 2));
  }
}
