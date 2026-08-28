// From baked volumes to the atlas the browser downloads.
//
//   node tools/clouds/pack-atlas.mjs [--rank N] [--from DIR] [--tile N] piece ...
//
// NOT wired into any build script and it must not be: it reads volumes that took
// a quarter of an hour of one core each and writes an asset that is committed,
// not produced on the way to a deploy.
//
// WHAT COMES IN. One directory per piece as `bake-volumes.mjs` leaves it:
// coverage, the ambient terms, and one channel per sun plane per surface term.
// For the production ring that is sixteen planes times three channels, which at
// 512 square and sixteen bits is three and a half megabytes a piece — fine as
// SOURCE, and several times the whole sky's shipping budget for two dozen of
// them.
//
// WHAT GOES OUT. Two RGBA textures and a JSON. The first texture carries three
// spatial maps and the coverage; the second carries four more. The JSON carries,
// per piece, the coefficient curve of each map along the arc and the range each
// map was normalised by — from which the runtime computes, once per frame per
// piece, one offset and R gains, and the fragment is a dot product.
//
// THREE REDUCTIONS, IN ORDER, AND EACH ONE MEASURED.
//
//   1. THE SURFACE MIX IS FOLDED. The shading reads lit + cA*surfA + cB*surfB
//      with a mix that was fitted once and then frozen, and cA is zero. Three
//      channels a plane are therefore one channel a plane, exactly — the error
//      of the fold is 0.000000 levels, because it is algebra and not
//      approximation. That alone is a third of the source, and the sixteen
//      planes of surfA are a channel multiplied by zero.
//   2. THE AMBIENT IS ABSORBED. base + range*ao*(0.5 + 0.5*n.y) does not depend
//      on the sun, so it is a constant column of the matrix and the basis takes
//      it into a component. Neither `ao` nor `normal` is shipped; nothing in the
//      delivered shading reads normal.x or normal.z at all.
//   3. WHAT IS LEFT IS FITTED. See cloud-basis.mjs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import {
  AMB_BASE, AMB_RANGE, EXPOSURE, palette, toDisplay,
} from './cloud-tone.mjs';
import { SURF_MIX } from './cloud-pieces.mjs';
import {
  fitChromaticity, fitLogBasis, LOG_FLOOR, mapRange, toneWeights,
} from './cloud-basis.mjs';
import { readChannel, readNormalY } from './cloud-channels.mjs';
import { composeTiles } from './cloud-compose.mjs';
import { stripAncillaryChunks } from '../grade/lib/png.mjs';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 ? d : argv[i + 1];
};
const RANK = Number(opt('rank', 7));
const FROM = opt('from', `${ROOT}assets-src/clouds/volumes`);
const OUT = opt('out', `${ROOT}assets-src/clouds`);
// Where each piece STANDS, which is the one thing a bake cannot know.
//
// A volume is a body and an atlas is where it is written; neither says at what
// bearing the sky shows it, how large, rolled which way. That is a composition,
// it is a decision, and it comes in as a file. Without one this writes the
// atlas and no composition, and the runtime keeps drawing the photographic
// field — which is the right failure, because a sky with pieces and no
// composition is a sky nobody has designed.
const COMPOSE = opt('compose', null);
const NAMES = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!NAMES.length) { console.error('usage: pack-atlas.mjs [--rank N] [--from DIR] piece ...'); process.exit(1); }

const { tint } = await palette();
const lum = (v) => {
  const d = toDisplay(tint(Math.max(0, v) * EXPOSURE, [0, 0, 0]));
  return 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];
};

// --------------------------------------------------------------- reading in

async function readPiece(name) {
  const dir = `${FROM}/${name}`;
  const head = JSON.parse(readFileSync(`${dir}/piece.json`, 'utf8'));
  const K = head.suns.length;
  // Every plane has to sit at a known place on the arc, and they have to be in
  // order: the coefficient curve is a function of that parameter, and a sample
  // with no parameter is not a sample of it.
  if (head.suns.some((s) => typeof s.t !== 'number')) {
    throw new Error(`${name}: a sun plane with no arc parameter; this piece was not baked on the ring`);
  }
  if (head.suns.some((s, i) => i && s.t <= head.suns[i - 1].t)) {
    throw new Error(`${name}: sun planes out of order along the arc`);
  }
  const alpha = (await readChannel(`${dir}/alpha.png`)).data;
  const ao = (await readChannel(`${dir}/ao.png`)).data;
  const ny = (await readNormalY(`${dir}/normal.png`)).data;
  const N = head.width * head.height;
  const M = new Float64Array(N * K);
  const use = SURF_MIX.cA !== 0;
  for (let k = 0; k < K; k++) {
    const tag = String(k).padStart(2, '0');
    const lit = (await readChannel(`${dir}/lit-${tag}.png`)).data;
    const sB = existsSync(`${dir}/surfB-${tag}.png`) ? (await readChannel(`${dir}/surfB-${tag}.png`)).data : null;
    const sA = use && existsSync(`${dir}/surfA-${tag}.png`) ? (await readChannel(`${dir}/surfA-${tag}.png`)).data : null;
    for (let i = 0; i < N; i++) {
      const amb = AMB_BASE + AMB_RANGE * ao[i] * (0.5 + 0.5 * ny[i]);
      M[i * K + k] = lit[i] + amb
        + (sB ? SURF_MIX.cB * sB[i] : 0) + (sA ? SURF_MIX.cA * sA[i] : 0);
    }
  }
  return {
    name, head, K, N, alpha, M,
  };
}

// ---------------------------------------------------------------- the fit
//
// One piece at a time, and its illumination matrix dropped the moment its maps
// exist. That matrix is a quarter of a million rows by twenty-nine columns of
// double — sixty megabytes — and two dozen of them held at once is a gigabyte
// and a half of a quantity nothing reads twice. The maps that replace it are
// seven single-precision channels, fourteen megabytes.

const pieces = [];
let radLo = Infinity; let radHi = 0;
for (const n of NAMES) {
  const p = await readPiece(n);
  for (let i = 0; i < p.N; i++) {
    if (p.alpha[i] <= 0.002) continue;
    for (let k = 0; k < p.K; k++) {
      const v = p.M[i * p.K + k] * EXPOSURE;
      if (v < radLo) radLo = v;
      if (v > radHi) radHi = v;
    }
  }
  const cols = [...Array(p.K).keys()];
  const w = toneWeights(p.M, p.N, p.K, cols, p.alpha, lum);
  const f = fitLogBasis(p.M, p.N, p.K, cols, RANK, w);
  p.basis = f;
  p.ranges = f.maps.map((m) => mapRange(m, p.alpha));
  p.M = null;
  // The energy left after each term, which is what a rank is chosen on.
  const tot = f.values.reduce((a, b) => a + b, 0);
  let acc = 0;
  const left = f.values.map((v) => { acc += v; return 1 - acc / tot; });
  console.log(`${p.name}: rank ${RANK}, residual energy after each term `
    + `${left.slice(0, RANK).map((v) => v.toExponential(1)).join(' ')}`);
  pieces.push(p);
}

const chroma = fitChromaticity(tint, [radLo * 0.95, radHi * 1.05], [radLo, radHi]);
console.log(`radiance ${radLo.toFixed(3)} to ${radHi.toFixed(3)}; chromaticity fit worst `
  + `${chroma.worstLevels.toFixed(2)} levels at ${chroma.worstAt.toFixed(2)}`);

// -------------------------------------------------------------- the atlas
//
// A GRID of tiles, gutters the width the mip chain needs. Coverage takes the
// alpha of the first texture, which is the one channel that must stay linear —
// an sRGB format leaves alpha alone, which is exactly why the maps can have the
// transfer and the coverage can not.
//
// A grid and not the single row this used to lay, and the reason is the count.
// Three pieces in a row is 1584 texels wide; twenty-four is 12488, which is
// inside what a desktop will allocate and outside what several mobile parts
// will, for a picture that is 96 per cent empty in one axis. Square-ish costs
// nothing — the encoder charges by the texel and the texel count is the same —
// and it keeps every side under three thousand.
//
// The gutter can stay at eight because of a property of these pieces rather
// than because eight is enough for a mip chain: every silhouette is WHOLE by
// construction, so the coverage at a tile's border is zero, and everything the
// shader emits is multiplied by that coverage. What bleeds across a gutter deep
// in the mip chain is therefore transparent on both sides of it.

// The second texture ships at a fraction of the first one's side.
//
// Not a guess: the components after the first three were measured to carry
// almost nothing above half Nyquist — 0.005 to 0.056 of their own variance —
// and reducing them by two costs 0.03 of a display level while a fixed-rate
// block codec charges by the texel, so it is a third of the atlas for nothing.
// The FIRST texture is never reduced, because it carries coverage, and coverage
// is the silhouette: the detail an eye reads on a billow is in its outline and
// in the first map, and what follows is broad shape.
const SHRINK = Number(opt('shrink', 2));
const TILE = Number(opt('tile', pieces[0].head.width));
const GUT = 8;
const COLS = Number(opt('cols', Math.ceil(Math.sqrt(pieces.length))));
const ROWS = Math.ceil(pieces.length / COLS);
const nTex = 1 + Math.ceil(Math.max(0, RANK - 3) / 4);
const slot = (r) => (r < 3 ? [0, r] : [1 + Math.floor((r - 3) / 4), (r - 3) % 4]);

mkdirSync(OUT, { recursive: true });
const files = [];
const geometry = [];
for (let t = 0; t < nTex; t++) {
  // Reduced AGAIN at every texture, not once and then held. The maps are in
  // order of the energy they carry, so the third texture holds the flattest of
  // them: measured on the real pieces, a quarter of the side there costs
  // nothing readable and pays for the rank that made the fit worth opening it.
  const s = t === 0 ? 1 : SHRINK ** t;
  // The gutter is divided EXACTLY and never clamped up to a floor. One texture
  // coordinate addresses every texture of the atlas, and that holds only while
  // each one is the first one's geometry divided by a whole number — gutters
  // included, because they are part of the stride. A gutter clamped at four
  // breaks it on the third texture, and the runtime's answer to an atlas it
  // cannot address with one coordinate is to draw the photographic field
  // instead: the delivery would look like it shipped and change nothing.
  if (TILE % s !== 0 || GUT % s !== 0) {
    throw new Error(`shrink ${s} divides neither tile ${TILE} nor gutter ${GUT} exactly: `
      + 'the atlas would need a second texture coordinate');
  }
  const tile = TILE / s; const gut = GUT / s;
  const W = COLS * (tile + gut) + gut;
  const H = ROWS * (tile + gut) + gut;
  const data = new Uint8Array(W * H * 4);
  for (let pi = 0; pi < pieces.length; pi++) {
    const p = pieces[pi];
    const x0 = gut + (pi % COLS) * (tile + gut);
    const y0 = gut + Math.floor(pi / COLS) * (tile + gut);
    for (let r = 0; r < RANK; r++) {
      const [tt, sl] = slot(r);
      if (tt !== t) continue;
      const { lo, hi } = p.ranges[r]; const m = p.basis.maps[r];
      for (let j = 0; j < tile; j++) {
        for (let i = 0; i < tile; i++) {
          let v = 0;
          for (let b = 0; b < s; b++) for (let a = 0; a < s; a++) v += m[(j * s + b) * p.head.width + i * s + a];
          data[((y0 + j) * W + x0 + i) * 4 + sl] = Math.round(255
            * Math.min(1, Math.max(0, (v / (s * s) - lo) / (hi - lo))));
        }
      }
    }
    if (t === 0) {
      for (let j = 0; j < tile; j++) {
        for (let i = 0; i < tile; i++) {
          data[((y0 + j) * W + x0 + i) * 4 + 3] = Math.round(255
            * Math.min(1, Math.max(0, p.alpha[j * p.head.width + i])));
        }
      }
    }
  }
  const path = `${OUT}/cloud-relit-${String.fromCharCode(97 + t)}.png`;
  const encoded = await sharp(Buffer.from(data), { raw: { width: W, height: H, channels: 4 } })
    .png({ compressionLevel: 9 }).toBuffer();
  // The encoder stamps a physical-dimensions chunk on its way out, and an atlas
  // is an asset the project ships: nothing about the machine, the software or
  // the moment it was made travels with it. Same rule and same helper as every
  // other delivered PNG — check-png.mjs is the gate that says so.
  writeFileSync(path, stripAncillaryChunks(encoded));
  files.push(path);
  geometry.push({
    file: path.split(/[\\/]/).pop(), width: W, height: H, tile, gutter: gut, shrink: s, cols: COLS,
  });
}
const W = geometry[0].width; const H = geometry[0].height;

// ---------------------------------------------------------- the composition
//
// The silhouette rule and the filling-in of what a piece can answer for itself
// live in tools/clouds/cloud-compose.mjs, so that a change of composition — which
// happens far more often than a change of fit — does not have to refit twenty
// three pieces to be written into a manifest.

// ------------------------------------------------------------ the manifest

// The arc itself: the parameter is what the runtime interpolates the curves in,
// and it is the state a day/night cycle and a monolith's trigger both move.
const arc = pieces[0].head.suns.map((s, k) => ({
  name: s.name, t: s.t, az: s.az, el: s.el, k,
}));
const composition = COMPOSE
  ? composeTiles(JSON.parse(readFileSync(COMPOSE, 'utf8')),
    new Map(pieces.map((p) => [p.name, p])))
  : null;
if (composition) {
  console.log(`composition: ${composition.tiles.length} piece(s) standing, `
    + `${composition.placements.length} placement(s), `
    + `${composition.tiles.reduce((t, x) => t + x.parts.length, 0)} quads, `
    + `mean cover ${(composition.tiles.reduce((t, x) => t + x.areaRatio, 0)
      / composition.tiles.length).toFixed(3)} of the windows`);
}

writeFileSync(`${OUT}/cloud-relit.json`, JSON.stringify({
  atlas: { textures: geometry },
  rank: RANK,
  tone: { exposure: EXPOSURE, logFloor: LOG_FLOOR },
  chromaticity: { red: chroma.red, blue: chroma.blue, band: chroma.band, worstLevels: chroma.worstLevels },
  arc,
  tiles: pieces.map((p, pi) => ({
    name: p.name,
    // One rectangle per texture: they are at different resolutions, and a
    // reader that assumes otherwise reads the wrong texels off the second one.
    rects: geometry.map((g) => ({
      x: g.gutter + (pi % g.cols) * (g.tile + g.gutter),
      y: g.gutter + Math.floor(pi / g.cols) * (g.tile + g.gutter),
      width: g.tile,
      height: g.tile,
    })),
    ranges: p.ranges.map((r) => [r.lo, r.hi]),
    // One row per map: its coefficient at every baked direction. The runtime
    // reads these with a Catmull-Rom in the arc parameter, which costs nothing
    // and is the whole reason the angular resolution is free.
    curves: p.basis.vectors.map((v) => Array.from(v, (x) => Number(x.toFixed(7)))),
  })),
  // Where the pieces stand. Absent when no composition was given, and the
  // runtime treats an atlas with no composition as an atlas it cannot draw —
  // which is what keeps a half-finished delivery out of the sky.
  ...(composition ? { composition } : {}),
}, null, 2));

console.log(`\n${files.length} texture(s) ${W}x${H} -> ${files.join(', ')}`);
console.log(`manifest -> ${OUT}/cloud-relit.json`);
