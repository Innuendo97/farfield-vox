// Step four: the pieces, into the atlas and the manifest the sky already reads.
//
//   node tools/clouds/ingest/pack.mjs <pieces-dir> [...] --out <dir> \
//        [--texelDeg 0.09] [--compose file.json] [--ring] [--calibrateAt 15]
//
// NOTHING NEW IS INVENTED HERE. What comes out is exactly the pair the
// photographic field in src/world/clouds.js has always consumed — one RGBA
// texture whose three channels are colour already multiplied by the coverage in
// the fourth, and one manifest of tiles with their rectangles, their angular
// windows, the sun each was photographed under and the cell runs their
// silhouette is drawn on. These pieces are photographs of cloud exactly as the
// pieces cut out of the reference were, so they take the same path and cost the
// same taps. They are NOT relit: a plate's light is in its pixels, and
// src/world/clouds.js turns the ratio off for the whole photographic field.
//
// The silhouette rule is imported from tools/clouds/cloud-compose.mjs rather
// than restated, so there is ONE definition of what a cell is and the generated
// path and this one cannot come to disagree about it.
//
// WHAT IS DECIDED HERE AND NOWHERE ELSE.
//
// THE SAMPLING RATE. A plate arrives at about a twentieth of a degree a texel
// and a bank is eighty degrees wide, so twenty pieces at their own resolution
// are thirteen million texels — six times an atlas this project is allowed to
// ship. The rate is therefore a decision, it is taken once for the whole atlas
// so that no piece is sharper than its neighbours for no reason, and it is
// stated in DEGREES OF SKY WHERE THE PIECE STANDS — which is not the same thing
// as degrees inside its own window, because the composition scales it. See the
// note over `texelDegOf`.
//
// THE LEVEL. A photograph carries a ratio and not a radiance: its exposure is
// nobody's record. So each plate is brought into the world's units by its own
// sky — the one thing in it whose counterpart here is known, because this world
// draws its sky from a model — and the atlas's scale is then only the range
// eight bits are spread over. What is stored is the colour over that scale
// through the sRGB transfer, because eight bits spread linearly put their steps
// where a cloud has none; the coverage stays linear, which is what an alpha
// channel is.

import {
  existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { writeCleanPng } from '../../grade/lib/png.mjs';
import { linearToSrgb } from '../../grade/lib/color.mjs';
import { silhouette } from '../cloud-compose.mjs';
import { domeAt } from '../../grade/lib/sky-model.mjs';
import {
  NORMAL_SLOPE, SHADE_AMBIENT, SHADE_DIFFUSE, SHADE_FORWARD,
} from '../../grade/lib/cloud-field.mjs';
import { basisOf } from './lib/pieces.mjs';
import { blur } from './lib/matte.mjs';

const DEG = Math.PI / 180;
const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 ? d : argv[i + 1];
};
const flag = (k) => argv.includes(`--${k}`);
const OUT = opt('out', null);
const ROSTER = opt('roster', `${ROOT}assets-src/clouds/plates.json`);
const dirs = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!dirs.length || !OUT) {
  console.error('usage: pack.mjs <pieces-dir> [...] --out <dir> [--texelDeg d] [--compose f] [--ring] [--holdLevel s]');
  process.exit(1);
}
const roster = existsSync(ROSTER) ? JSON.parse(readFileSync(ROSTER, 'utf8')) : {};
const world = roster.world || {};
const TEXEL_DEG = Number(opt('texelDeg', 0.09));
const GUTTER = 8;
// The height the sky's own radiance is read at to calibrate a plate against the
// world. The pieces stand between ten and thirty degrees up; fifteen is where
// most of the weather sits and the dome changes slowly enough there that the
// choice is worth a few per cent, not a factor.
const CALIBRATION_ELEVATION = Number(opt('calibrateAt', 15));
const MAX_SIDE = Number(opt('maxSide', 2048));

const round = (v, n = 4) => Number(v.toFixed(n));

// ------------------------------------------------------------- reading in

function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (!name.endsWith('.json')) {
      if (!name.includes('.')) out.push(...collect(path));
      continue;
    }
    const head = JSON.parse(readFileSync(path, 'utf8'));
    if (!head.width) continue;
    const body = readFileSync(join(dir, `${basename(name, '.json')}.piece`));
    const n = head.width * head.height;
    out.push({
      head,
      alpha: new Float32Array(body.buffer, body.byteOffset, n),
      rgb: new Float32Array(body.buffer, body.byteOffset + n * 4, n * 3),
    });
  }
  return out;
}

const pieces = dirs.flatMap(collect);
if (!pieces.length) { console.error('no piece under those directories'); process.exit(1); }

// --------------------------------------------------------- the composition
//
// Where a piece STANDS is a decision and not a measurement, so it comes in as a
// file. Without one this writes the atlas and a manifest with nothing standing,
// which is the right failure: a sky with pieces and no composition is a sky
// nobody has designed. `--ring` lays every piece once round the compass, which
// is for LOOKING AT THE PIECES and is not a composition.
//
// It is read FIRST, because both the sampling rate and the level depend on it.

const composition = (() => {
  const file = opt('compose', null);
  if (file) return JSON.parse(readFileSync(file, 'utf8'));
  if (!flag('ring')) return { placements: [] };
  const step = 360 / pieces.length;
  return {
    placements: pieces.map((p, i) => ({
      id: `${p.head.id}@ring`,
      tile: p.head.id,
      azimuth: round(-180 + step * (i + 0.5), 2),
      elevation: round(Math.max(6, p.head.spanV / 2 - 2), 2),
      scale: 1,
      roll: 0,
      flip: 1,
    })),
  };
})();

// -------------------------------------------------- to the atlas's own rate
//
// Box averaged, on the PREMULTIPLIED colour and the coverage together, which is
// the one way to resample a matte without dragging a filtered edge towards
// black: the average of a premultiplied colour is the premultiplied colour of
// the average, and the average of a coverage is the coverage of the average.
//
// AND THE RATE IS STATED WHERE THE PIECE STANDS, not inside its own window.
//
// A piece is cut at whatever angular size its plate gave it and is then drawn at
// the scale the composition asks for: a window fifty two degrees wide stood at
// two fifths is twenty one degrees of sky drawn with the same texels, so its
// rate ON THE SCREEN is two fifths of its rate in the atlas. Fixing the rate
// inside the window therefore does the opposite of what one rate for the whole
// atlas is for — it makes the small placements two and three times sharper than
// the large ones and pays for it in texels nobody can find. Measured on this
// delivery: 3.21 million texels that way and 1.96 this way, against the 4.19 a
// two thousand and forty eight square holds, which is the whole difference
// between fitting and not.
//
// So a piece is cut at TEXEL_DEG over the largest scale the composition ever
// stands it at, and every piece is then equally sharp where the eye meets it. A
// plate may ask for coarser still in the roster — a sheet of high cirrus has no
// silhouette to lose — and the coarser of the two wins.
const standScale = new Map();
for (const stand of [...(composition.placements || []), ...(composition.tiles || [])]) {
  const id = stand.tile || stand.id;
  const s = stand.scale === undefined ? 1 : stand.scale;
  if (!(standScale.get(id) >= s)) standScale.set(id, s);
}
const texelDegOf = (piece) => {
  const entry = (roster.plates || []).find((e) => e.id === piece.head.plate) || {};
  const scale = standScale.get(piece.head.id);
  const onScreen = TEXEL_DEG / (scale === undefined ? 1 : Math.max(1e-3, scale));
  return Math.max(onScreen, Number(entry.texelDeg ?? 0));
};

for (const p of pieces) {
  const { head } = p;
  p.texelDeg = texelDegOf(p);
  const shrink = Math.max(1, Math.round(p.texelDeg / head.degPerTexel));
  const four = (v) => Math.max(4, Math.floor(v / 4) * 4);
  const w = four(Math.round(head.width / shrink));
  const h = four(Math.round(head.height / shrink));
  const a = new Float32Array(w * h);
  const c = new Float32Array(w * h * 3);
  for (let j = 0; j < h; j++) {
    const y0 = Math.floor(j * head.height / h);
    const y1 = Math.max(y0 + 1, Math.floor((j + 1) * head.height / h));
    for (let i = 0; i < w; i++) {
      const x0 = Math.floor(i * head.width / w);
      const x1 = Math.max(x0 + 1, Math.floor((i + 1) * head.width / w));
      let sa = 0; const sc = [0, 0, 0];
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = y * head.width + x;
          sa += p.alpha[o];
          for (let k = 0; k < 3; k++) sc[k] += p.rgb[o * 3 + k];
          n++;
        }
      }
      a[j * w + i] = sa / n;
      for (let k = 0; k < 3; k++) c[(j * w + i) * 3 + k] = sc[k] / n;
    }
  }
  p.width = w;
  p.height = h;
  p.alpha = a;
  p.rgb = c;
  p.degPerTexel = 2 * Math.atan(head.halfU) / DEG / w;
}

// ------------------------------------------------------------- the density
//
// HOW DEEP A PIECE IS, and it is the one thing about a plate that the plate
// cannot be asked.
//
// A matte lifts the cloud off the sky it was photographed against and what
// comes back is the coverage that PHOTOGRAPH had: this bank, at this distance,
// through that day's air. Measured on the delivery this unit inherited, the
// mean pixel metro14 calls cloud is a little under half cloud and the rest of
// it is the dome showing through, and the frame reads exactly as that says it
// should — grey, and see-through, against a reference whose banks are solid.
// The material is not the problem: at full coverage the same pixels carry two
// and eight tenths the radiance of the sky behind them, which is more contrast
// than the unit is asked for. There is simply not enough of it in the way.
//
// So a piece is given a depth, and the shape of the knob is the one physics
// has: coverage is 1 − exp(−τ), so a piece seen through d times its own depth
// is 1 − (1 − a)^d. Monotone, exactly nought where the piece is nought and
// exactly one where it is one — so no silhouette moves and no edge appears —
// and it does its work in the middle, which is where the veil is.
//
// It is NOT a threshold and it is not a contrast stretch on the picture. Both
// of those cut material; this one only ever makes the material there thicker,
// which is what "recover the coverage with density, not with thresholds" asks
// for. The colour is scaled with it because the atlas is premultiplied: what
// the cloud's own material is stays what it was.
const densityOf = (plate) => {
  const entry = (roster.plates || []).find((e) => e.id === plate) || {};
  const value = opt('density', entry.density ?? roster.defaults?.density ?? 1);
  return Math.max(0.05, Number(value));
};
for (const p of pieces) {
  const d = densityOf(p.head.plate);
  p.density = d;
  if (d === 1) continue;
  for (let i = 0; i < p.width * p.height; i++) {
    const a = p.alpha[i];
    if (a <= 0) continue;
    const thick = 1 - (1 - Math.min(1, a)) ** d;
    const scale = thick / a;
    p.alpha[i] = thick;
    for (let k = 0; k < 3; k++) p.rgb[i * 3 + k] *= scale;
  }
}

// ------------------------------------------------------------- the border
//
// HOW LONG AN EDGE TAKES TO BECOME SKY, and it is a WIDTH this atlas was short
// of rather than a brightness.
//
// metro14 measures a border by the mean luminance profile across the silhouette
// against signed distance from it, and reports the ten to ninety width. Read on
// the reference and on the delivery of DEV-C10, at the same framing and with
// the same instrument (the whole profile that one number comes from was
// printed and read, not just its width):
//
//   reference   inside 215.1 L  outside 125.8 L   90% at -0.764  10% at +1.409
//   DEV-C10     inside 196.9 L  outside 120.9 L   90% at -0.362  10% at +0.600
//
// Both sides are short and the far side is shorter. A tenth of a degree out the
// reference stands at 145.8 L and it is STILL at 142 L eight tenths out, coming
// down to its open sky only two and a half degrees away; ours is at 148.3 at a
// tenth and at 128.5 six tenths out. The same edge, with nothing beyond it.
//
// AND THE RING THE COVERAGE IS ALREADY RAMPED ACROSS CANNOT WRITE IT. That ring
// is made of cells whose own peak is under CELL_LIVE, one part in 255, so what
// it carries is at most one part in 255: the run prints it tile by tile as
// "ramp took", and on this roster it reads between 0.000 and 0.008 per cent of
// a piece's coverage. Widening a ramp over material that is not there is
// arithmetic on nothing. The border has to be made of MATERIAL, and this is
// where it is made.
//
// WHAT THIS IS NOT, and both were built and measured before this one was:
//
//   a' = max(a, cap * G_sigma(a)) — a shelf of forward scattered light laid
//   round the body under a ceiling. It works: the border went from 0.962 to
//   1.536 degrees. It also costs 3.9 points of coverage, and a map of where
//   they go says it — 88 per cent of the gain stands within half a degree of
//   the old silhouette, which is the silhouette WALKING OUTWARDS. A frame that
//   classifies cloud by a threshold cannot tell a soft edge from a bigger one.
//
//   a' = max(a, cap * (1 - smoothstep(d / reach))) — the same shelf with the
//   flat profile the reference actually has, off the chamfer distance. Wider
//   still (1.846 at reach 14, ceiling 0.12) and worse twice over: 5.8 points of
//   coverage, and because the shelf is FLAT it fills each piece's window to its
//   own margin and the frame comes back with a rectangle of haze round every
//   placement. That was built and shot, and the sheet is the reason neither
//   form is delivered.
//
// Both fail for one reason: they only ever ADD. A border is not a thing added
// outside an edge, it is the edge STRETCHED — as much taken off the inside as
// put on the outside — and that is what this does:
//
//   a' = a + w * (G_sigma(a) - a),  rgb' = rgb + w * (G_sigma(rgb) - rgb)
//
// A partial blur of the premultiplied pair, which is a resampling of the piece
// and cannot invent a colour: at w = 1 it is the piece seen through an aperture
// sigma wide, at w = 0 it is the piece. Its mean coverage is the mean coverage,
// so the frame's own cloud count does not move, and its half coverage contour —
// the line every placement's width is stated on — stays where it was, so the
// composition arrives at the size it asks for.
//
// AND IT IS HELD TO THE EDGE, which is the difference between a border and a
// soft atlas. The weight falls to nothing a stated distance INSIDE the half
// coverage contour, so the notches and the lobes of a bank's own face keep the
// contrast the source gave them and only the rim is stretched. Outside the
// contour there is nothing to protect and the weight is full.
//
// STATED IN THE PIECE'S OWN DEGREES, like every other width in this chain, so a
// placement that stands a bank at a quarter of its plate's scale gets a quarter
// of the border. A cumulus twice as far away has half the rim, in degrees, and
// the same rim in metres.
const featherDegOf = (plate) => {
  const entry = (roster.plates || []).find((e) => e.id === plate) || {};
  return Math.max(0, Number(opt('feather', entry.featherDeg ?? roster.defaults?.featherDeg ?? 0)));
};
const featherMixOf = (plate) => {
  const entry = (roster.plates || []).find((e) => e.id === plate) || {};
  return Math.max(0, Math.min(1,
    Number(opt('featherMix', entry.featherMix ?? roster.defaults?.featherMix ?? 1))));
};
const featherShrinkOf = (plate) => {
  const entry = (roster.plates || []).find((e) => e.id === plate) || {};
  return Math.max(0, Number(opt('featherShrink',
    entry.featherShrinkDeg ?? roster.defaults?.featherShrinkDeg ?? 0)));
};
const HOLD_SIGMA = Number(opt('featherHold', roster.defaults?.featherHold ?? 0.6));
const OUT_SIGMA = Number(opt('featherOut', roster.defaults?.featherOut ?? 2));
let featherMoved = 0;
let featherTotal = 0;
for (const p of pieces) {
  const reach = featherDegOf(p.head.plate);
  const mix = featherMixOf(p.head.plate);
  p.featherDeg = reach;
  p.featherMix = mix;
  // AND THE WIDTH IS STATED IN DEGREES OF THE SKY AS DRAWN, which is the one
  // place in this chain where a width is NOT the plate's own.
  //
  // Every other width here — fadeDeg, veilReachDeg, dilateDeg — belongs to the
  // plate and is scaled with it, because it describes the MATERIAL. This one
  // describes the FRAME: it is how far a border is asked to run across the
  // picture, and a picture does not know which plate it came from. Taken in the
  // plate's own degrees it came out four degrees wide on a window fifty two
  // across and four degrees wide on a window eighteen across — on the small
  // pieces a blur as wide as their own window, which smears the material flat
  // over the whole of it and hands the frame a RECTANGLE of haze cut at the
  // window's margin. That was built and shot, and it is in the frame.
  //
  // A piece is resampled at TEXEL_DEG over the largest scale it ever stands at,
  // so a texel of the atlas is the same angle of sky whatever piece it belongs
  // to, and the same number of texels is the same width of border everywhere.
  const onScreen = Math.max(1e-6, p.degPerTexel * (standScale.get(p.head.id) ?? 1));
  // AND IT IS BOUNDED BY THE TILE, which is the same failure as the paragraph
  // above arriving from the other side.
  //
  // Stating the width in drawn degrees fixes a piece drawn at its plate's own
  // scale. It does NOT fix a piece drawn at a fraction of it, because the atlas
  // resamples at TEXEL_DEG over that same fraction: a piece stood at an eighth
  // is cut to a tile an eighth as wide, and half a degree of drawn sky is the
  // same number of texels on a tile that no longer has them. Measured on the
  // delivery this unit inherited, `alpha-08-frammenti-a-5` stands at 0.127 and
  // arrives as 36 by 20 texels with a sigma of 5.8 — a blur wider than the tile
  // is tall. What came out was the rectangle of haze this operator was written
  // to avoid: the fragment's ragged silhouette smeared flat over its whole
  // window, cut at the window's margin, and plainly visible in the frame — shot
  // whole, and shot again as the same fragment before and after the operator.
  //
  // An eighth of the smaller side is where the operator is still a RIM: it
  // reaches OUT_SIGMA out and HOLD_SIGMA in, so past that it is holding the
  // body and not its edge. On this roster it binds on that one tile and on no
  // other — the next closest is 5.64 against a bound of 6.00 — so what it
  // changes is exactly the tile that was broken.
  const sigma = Math.min(reach / onScreen, Math.min(p.width, p.height) / 8);
  const shrink = featherShrinkOf(p.head.plate) / onScreen;
  if (!(reach > 0) || !(mix > 0) || sigma < 0.5) continue;
  // How far each texel stands INSIDE the piece's own half coverage contour, by
  // two chamfer sweeps. The same contour reconstructShoulder measures its reach
  // from and the same one a placement states a piece's width on.
  const dist = new Float32Array(p.width * p.height).fill(Infinity);
  const away = new Float32Array(p.width * p.height).fill(Infinity);
  let seeds = 0;
  let core = 0;
  for (let i = 0; i < p.width * p.height; i++) {
    if (p.alpha[i] < 0.5) { dist[i] = 0; seeds++; } else { away[i] = 0; core++; }
  }
  // A PIECE WITH NO CORE HAS NO RIM. A sheet of high veil never reaches half
  // coverage anywhere, so every texel of it is "outside" and the weight below
  // would be full over the whole window: what comes out is not a border, it is
  // the veil blurred, and a blurred veil at the zenith is the slab two gates
  // have already rejected. Such a plate is left exactly as it is.
  if (!core) continue;
  const relax = (field, order) => {
    for (let k = 0; k < p.height; k++) {
      const y = order > 0 ? k : p.height - 1 - k;
      for (let m = 0; m < p.width; m++) {
        const x = order > 0 ? m : p.width - 1 - m;
        const i = y * p.width + x;
        let d = field[i];
        for (const [dx, dy, w] of [[-order, 0, 1], [0, -order, 1],
          [-order, -order, Math.SQRT2], [order, -order, Math.SQRT2]]) {
          const xx = x + dx; const yy = y + dy;
          if (xx < 0 || xx >= p.width || yy < 0 || yy >= p.height) continue;
          d = Math.min(d, field[yy * p.width + xx] + w);
        }
        field[i] = d;
      }
    }
  };
  if (seeds) { relax(dist, 1); relax(dist, -1); } else dist.fill(0);
  relax(away, 1); relax(away, -1);
  // AND THE SHRINK, WHICH IS WHAT PAYS FOR THE STRETCH.
  //
  // A frame that calls a pixel cloud by a threshold cannot tell a soft edge from
  // a bigger one: stretched and nothing else, this border takes the coverage
  // from 23.5 per cent of the sky to 30.0, and a map of where that gain lands
  // says seven tenths of it stands within half a degree of the old silhouette —
  // the silhouette walking outwards. The reference does not pay that: it carries
  // a border of 2.173 degrees at 21.8 per cent, which is to say its DENSE core
  // is smaller than ours and its soft rim stands INSIDE the footprint the core
  // used to fill.
  //
  // So the material is eroded before it is blurred, and the blur puts the
  // outside of the border back where the hard edge was. Erosion is a minimum
  // over a disc of the stated radius, taken on the coverage with the colour
  // carried down by the same factor so that a texel keeps the material's own
  // colour and only its depth changes. What comes out is the same footprint, the
  // same coverage, and a rim that is a ramp instead of a wall.
  //
  // The one thing it must not do is eat a body: the erosion is held to the same
  // rim the blur is, so a bank's interior arrives at the depth the source gave
  // it.
  let src = p.alpha;
  let srgb = p.rgb;
  if (shrink >= 0.5) {
    const r = Math.round(shrink);
    const ea = new Float32Array(p.width * p.height);
    const er = new Float32Array(p.width * p.height * 3);
    const rowMin = new Float32Array(p.width * p.height);
    for (let j = 0; j < p.height; j++) {
      for (let i = 0; i < p.width; i++) {
        let v = Infinity;
        for (let k = -r; k <= r; k++) {
          const x = Math.min(p.width - 1, Math.max(0, i + k));
          v = Math.min(v, p.alpha[j * p.width + x]);
        }
        rowMin[j * p.width + i] = v;
      }
    }
    for (let j = 0; j < p.height; j++) {
      for (let i = 0; i < p.width; i++) {
        let v = Infinity;
        for (let k = -r; k <= r; k++) {
          const y = Math.min(p.height - 1, Math.max(0, j + k));
          v = Math.min(v, rowMin[y * p.width + i]);
        }
        const o = j * p.width + i;
        // Held to the rim, like the blur: deep inside a body the material keeps
        // the depth the source gave it and the minimum is not taken.
        const t = Math.max(0, Math.min(1, dist[o] / Math.max(1, HOLD_SIGMA * sigma)));
        const g = mix * (1 - t * t * (3 - 2 * t));
        const a = p.alpha[o] + g * (v - p.alpha[o]);
        ea[o] = a;
        const f = a / Math.max(1e-6, p.alpha[o]);
        for (let k = 0; k < 3; k++) er[o * 3 + k] = p.rgb[o * 3 + k] * f;
      }
    }
    src = ea;
    srgb = er;
  }
  const ab = blur(src, p.width, p.height, 1, sigma);
  const cb = blur(srgb, p.width, p.height, 3, sigma);
  // HOW FAR INSIDE THE CONTOUR THE STRETCHING IS ALLOWED TO REACH, in multiples
  // of the blur's own width, and it is the number that decides whether this is a
  // border or a soft atlas. Outside the contour the weight is always full —
  // there is nothing out there to protect — and inside it comes down to nothing
  // smoothly, so the kept interior has no border of its own.
  //
  // Measured, at a reach of four degrees on this roster: held two sigma deep the
  // band contrasts fall from 0.46 to 0.33 at ten degrees of height, the micro
  // contrast from 2.94 to 1.77 and the largest mass from 78 per cent of the sky
  // to 34 — because half of a body six degrees across is within two sigma of its
  // own rim, so what is stretched is the body and not its edge.
  const hold = Math.max(1, HOLD_SIGMA * sigma);
  // AND THE FOOT OF IT IS CUT, WHICH IS NOT TIDINESS.
  //
  // A Gaussian has no end: the kernel reaches three sigma, so a body writes four
  // parts in ten thousand of coverage ten degrees of its own sky away. That is
  // under anything the eye can find and it is OVER CELL_LIVE, one part in 255 —
  // which is the line the quads are cut at. The union then swells to the frame
  // of the window, the ring of dead cells the coverage is ramped across is gone,
  // and the window is cut by its own margin instead: measured on the first build
  // of this operator, a rectangle of haze round every placement, plainly visible
  // at the reference framing, in the first two rows of the comparison sheet.
  //
  // So the border is taken to EXACTLY nought under the line the packing draws
  // its quads at, with a smoothstep between one and four parts in 255 so that
  // what is cut is never a step. What this removes is, by construction, under
  // one part in 255 of coverage; what it buys back is the ring.
  const LO = 1 / 255;
  const HI = 4 / 255;
  // AND HOW FAR OUT OF THE BODY IT IS ALLOWED TO GO, which is the other half of
  // the same rule and the one a Gaussian will not obey on its own. The kernel
  // reaches three sigma and the blur of a bank is still a hundredth of coverage
  // there — invisible on its own and NOT invisible where a window's frame cuts
  // it, which is a rectangle of haze round the placement. Shot and confirmed
  // twice, against the same layer without it. So the weight is
  // taken to nothing at OUT_SIGMA times the blur's own width outside the half
  // coverage contour: past that a texel keeps exactly the material it had, which
  // for open window is nought, and the union of live cells cannot swell to the
  // frame.
  const outReach = Math.max(1, OUT_SIGMA * sigma);
  for (let o = 0; o < p.width * p.height; o++) {
    const t = Math.max(0, Math.min(1, dist[o] / hold));
    const u = Math.max(0, Math.min(1, away[o] / outReach));
    const w = mix * (1 - t * t * (3 - 2 * t)) * (1 - u * u * (3 - 2 * u));
    featherTotal += p.alpha[o];
    if (w <= 0) continue;
    let a = p.alpha[o] + w * (ab[o] - p.alpha[o]);
    const rgbAt = [0, 1, 2].map((k) => p.rgb[o * 3 + k] + w * (cb[o * 3 + k] - p.rgb[o * 3 + k]));
    const s = Math.max(0, Math.min(1, (a - LO) / (HI - LO)));
    const foot = s * s * (3 - 2 * s);
    a *= foot;
    featherMoved += Math.abs(a - p.alpha[o]);
    p.alpha[o] = a;
    for (let k = 0; k < 3; k++) p.rgb[o * 3 + k] = rgbAt[k] * foot;
  }
}
if (featherMoved > 0) {
  process.stdout.write(`border: ${(100 * featherMoved / Math.max(1e-9, featherTotal)).toFixed(1)}% `
    + `of the coverage the pieces carry moved across the rim, at `
    + `${pieces[0].featherDeg} deg of a piece's own sky, mix ${pieces[0].featherMix}\n`);
}

// ------------------------------------------------------------ the grain
//
// WHY A BODY THAT CARRIES 67 PER CENT OF INNER SPAN IS DRAWN WITH 25, and what
// is done about it here rather than anywhere else.
//
// Measured, on the shipped chain, frame by frame with the composite opened up
// one stage at a time: the tile `alpha-01-banco-a-1` holds a p10-to-p90 span of
// 67.4 per cent of its own median; the SAMPLER hands that to the fragment
// whole, 68.8 on the frame's own grid; compositing over the sky where the
// coverage is not full takes 7.9 points off it and the halo 1.3; and then AgX
// takes THIRTY SIX AND A HALF. The reference draws 45.7 on the same mass with
// the same instrument. The material was never the problem and neither was the
// atlas's rate — DEV-C12 built that experiment and it bought five hundredths.
//
// AgX is the world's tone curve and it is not this chain's to touch: it is what
// the reference sky was graded against and src/core/sky.js and every surface in
// the world are fitted through it. What it does to a body sitting at a median
// radiance of 1.05 is compress a ratio by a power of about 0.38 — the same
// factor on the span, 68.8 to 23.1, and on the micro contrast, 8.3 per cent of
// modulation to 3.1. A curve that stands between the material and the eye and
// takes five eighths of its contrast is a curve the MATERIAL has to be written
// against. So the packing writes it against it: the piece's own modulation is
// raised to a power before it is ever stored, so that what comes out the far
// end of the tone curve is the contrast the cloud actually has.
//
// C' = C · exp(w · (k − 1) · (ln Y − <ln Y>_sigma))
//
// A power on the ratio of a texel to its own neighbourhood, which is to say a
// power on the CONTRAST and not on the light: a texel sitting exactly at its
// neighbourhood's level is not moved at all, so the piece's mean level, its
// colour and its coverage all come out where they went in.
//
// AND IT IS LOCAL, WHICH IS THE WHOLE DESIGN. Taken globally — a power about
// the tile's own median — it would expand a bank's top-to-bottom shading along
// with its billows, and a twenty degree bank's base would go dark enough to
// fall out of what metro14 calls cloud at all, taking the coverage net with it.
// What reads as cauliflower is the modulation at the half degree, which is the
// scale metro14's seven pixel kernel measures; everything wider than
// `grainReachDeg` is subtracted out first and put back untouched, so the band
// contrasts, the mass, the veil and the silhouette see nothing.
//
// THREE THINGS IT IS HELD BY:
//
//   the BODY only. The weight ramps from nought at GRAIN_LO of coverage to one
//   at GRAIN_HI, so the border DEV-C11 built is not touched and the edge step
//   and the transition come out where they went in. It is also why the mean of
//   the neighbourhood is taken WEIGHTED by that same ramp: an unweighted blur
//   near a silhouette averages in the empty window and would hand the rim a
//   spurious multiplier. The gate sits at 0.55 rather than at a third, and the
//   difference is measured: at a third the veils — material carrying half a
//   coverage, which metro14's saturation test does not call cloud at all — got
//   a share of the expansion too, and the light the layer writes far from
//   anything the frame calls cloud came back at 31.2 display levels worst
//   against DEV-C11's 13.9, read per window at the reference pose. Held to real
//   body it is 17.8, and the frame's micro contrast goes UP rather than down —
//   5.13 against 5.05 — because what the veils were taking was never the
//   cauliflower.
//
//   a CEILING on the multiplier. The exponential of a log residue has no bound
//   and a matte can leave a texel a thousandth of its neighbours; GRAIN_CEIL
//   holds what one texel may be moved by to a factor of four either way, which
//   on this roster fires on fewer than one texel in ten thousand.
//
//   ONE MULTIPLIER FOR THE THREE CHANNELS. It is computed on the luminance and
//   applied to red, green and blue alike, so it cannot move a chromaticity —
//   which is the net colore21 checks to a part in a hundred.
const GRAIN_LO = 0.55;
const GRAIN_HI = 0.85;
const GRAIN_CEIL = 4;
const grainGainOf = (plate) => {
  const entry = (roster.plates || []).find((e) => e.id === plate) || {};
  return Math.max(0, Number(opt('grain', entry.grainGain ?? roster.defaults?.grainGain ?? 1)));
};
const grainReachOf = (plate) => {
  const entry = (roster.plates || []).find((e) => e.id === plate) || {};
  return Math.max(0, Number(opt('grainReach',
    entry.grainReachDeg ?? roster.defaults?.grainReachDeg ?? 0)));
};
let grainTexels = 0;
let grainCapped = 0;
let grainRms = 0;
for (const p of pieces) {
  const k = grainGainOf(p.head.plate);
  const reach = grainReachOf(p.head.plate);
  // The same width convention the border uses, and for the same reason: a
  // texel of the atlas is the same angle of sky whatever piece it belongs to,
  // because a piece is resampled at TEXEL_DEG over the largest scale it ever
  // stands at. So the same number of texels is the same scale of grain
  // everywhere in the sky.
  const onScreen = Math.max(1e-6, p.degPerTexel * (standScale.get(p.head.id) ?? 1));
  const sigma = reach / onScreen;
  p.grainGain = k;
  p.grainReachDeg = reach;
  if (!(Math.abs(k - 1) > 1e-6) || !(sigma >= 0.5)) continue;
  const n = p.width * p.height;
  const weight = new Float32Array(n);
  const field = new Float32Array(n);
  const logY = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = p.alpha[i];
    const s = Math.max(0, Math.min(1, (a - GRAIN_LO) / (GRAIN_HI - GRAIN_LO)));
    weight[i] = s * s * (3 - 2 * s);
    if (weight[i] <= 0) continue;
    const Y = (0.2126 * p.rgb[i * 3] + 0.7152 * p.rgb[i * 3 + 1] + 0.0722 * p.rgb[i * 3 + 2])
      / Math.max(1e-6, a);
    if (!(Y > 1e-7)) { weight[i] = 0; continue; }
    logY[i] = Math.log(Y);
    field[i] = weight[i] * logY[i];
  }
  const fb = blur(field, p.width, p.height, 1, sigma);
  const wb = blur(weight, p.width, p.height, 1, sigma);
  for (let i = 0; i < n; i++) {
    if (weight[i] <= 0 || !(wb[i] > 1e-3)) continue;
    const d = logY[i] - fb[i] / wb[i];
    let m = Math.exp(weight[i] * (k - 1) * d);
    if (m > GRAIN_CEIL) { m = GRAIN_CEIL; grainCapped++; }
    if (m < 1 / GRAIN_CEIL) { m = 1 / GRAIN_CEIL; grainCapped++; }
    for (let c = 0; c < 3; c++) p.rgb[i * 3 + c] *= m;
    grainTexels++;
    grainRms += Math.log(m) ** 2;
  }
}
if (grainTexels > 0) {
  process.stdout.write(`grain: x${pieces[0].grainGain} on the contrast under `
    + `${pieces[0].grainReachDeg} deg of a piece's own sky, over ${grainTexels} body texels, `
    + `rms move ${(100 * Math.sqrt(grainRms / grainTexels)).toFixed(1)}%, `
    + `${grainCapped} at the ceiling of x${GRAIN_CEIL}\n`);
}

// ---------------------------------------------- closing a tile the ramp cannot
//
// WHERE A QUAD STOPS ON MATERIAL, AND WHY THE RAMP BELOW IS NOT ALWAYS THERE TO
// STOP IT.
//
// The ramp under the next heading takes the coverage to nothing across the ring
// of dead cells the union of live cells takes beyond the body, so the quad's
// boundary is an edge and not a step. It rests on that ring EXISTING. When a
// tile is small in texels the ring is not there: measured on the delivery this
// unit inherited, `alpha-08-frammenti-a-5` is resampled to 36 by 20 texels — it
// stands at a eighth of its plate's scale — its border is stretched by a blur
// whose width is stated in degrees of drawn sky and therefore covers six of
// those twenty texels, every cell of the tile comes back live (areaRatio 1),
// and the coverage still standing on the margin, up to 0.086, stops dead at the
// quad's own edge. In the frame that is a rectangle three degrees by one and
// three quarters with a FLAT BOTTOM, and it is what the frame shows and what
// tagli28 reads as a straight run of 24 pixels.
//
// It was invisible while the plates carried a dilated halo: a body whose own
// fringe is two and a half degrees wide hides a stop under it. Taking the halo
// off — which is the defect the committente named — is what made it legible.
// The two are one cure and this is its second half.
//
// SO THE WINDOW IS CLOSED WHERE IT CUTS CLOUD, AND ONLY THERE. Each margin of a
// tile is asked what it carries; a margin over the floor is brought to nothing
// across a band inside the tile and the others are not touched at all. It is
// the mechanism matte.mjs already closes a PLATE's window with — the same ramp,
// the same directionality, the same declaration of what it took — moved to the
// one place that knows how large a tile ended up: `fadeBandCover` is stated per
// edge for the plate's window, `closeBandCover` for the atlas's.
//
// IT IS NOT A SHELL AND IT CANNOT BECOME ONE. It only ever REMOVES coverage,
// on at most four bands, and never outside the tile it belongs to — so it
// cannot widen a silhouette, cannot write a fringe, and its whole effect on a
// piece whose margins are already quiet is exactly nothing.
//
// THE FLOOR IS A DISPLAY LEVEL. This material stands about fifty display levels
// off its own sky at full coverage — the same reading edgeCeiling is set by —
// so two hundredths of coverage is one level, which is under the dither the
// composite already carries. Below that a margin is quiet and closing it would
// only cost material for nothing.
//
// AND THE BAND IS BOUNDED BY THE TILE. A quarter of the smaller side is the
// most it may take: past that the band is the tile, which is the blur-as-wide-
// as-its-own-window failure the border above is written to avoid, arriving from
// the other side.
const CLOSE_DEG = Number(opt('close', roster.defaults?.closeDeg ?? 0.5));
const CLOSE_FLOOR = Number(opt('closeFloor', roster.defaults?.closeFloor ?? 0.02));
let closedEdges = 0;
let closedTiles = 0;
for (const p of pieces) {
  const { width: w, height: h } = p;
  const peak = {
    top: 0, bottom: 0, left: 0, right: 0,
  };
  for (let i = 0; i < w; i++) {
    peak.top = Math.max(peak.top, p.alpha[i]);
    peak.bottom = Math.max(peak.bottom, p.alpha[(h - 1) * w + i]);
  }
  for (let j = 0; j < h; j++) {
    peak.left = Math.max(peak.left, p.alpha[j * w]);
    peak.right = Math.max(peak.right, p.alpha[j * w + w - 1]);
  }
  p.closeEdgePeak = Object.fromEntries(Object.entries(peak).map(([k, v]) => [k, round(v, 5)]));
  const live = Object.fromEntries(Object.entries(peak).map(([k, v]) => [k, v > CLOSE_FLOOR]));
  p.closeBandCover = {
    top: 0, bottom: 0, left: 0, right: 0,
  };
  if (!Object.values(live).some(Boolean)) continue;
  // The band is stated in degrees of the sky as drawn, like the border above and
  // for the same reason: what it draws is a slope across the PICTURE, and a
  // picture does not know which plate a tile came from.
  const onScreen = Math.max(1e-6, p.degPerTexel * (standScale.get(p.head.id) ?? 1));
  const band = Math.max(1, Math.min(
    Math.round(CLOSE_DEG / onScreen),
    Math.floor(Math.min(w, h) / 4),
  ));
  const ramp = (d) => {
    const t = Math.max(0, Math.min(1, d / band));
    return t * t * (3 - 2 * t);
  };
  let total = 0;
  for (let i = 0; i < w * h; i++) total += p.alpha[i];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let k = 1;
      if (live.left) k = Math.min(k, ramp(i));
      if (live.right) k = Math.min(k, ramp(w - 1 - i));
      if (live.top) k = Math.min(k, ramp(j));
      if (live.bottom) k = Math.min(k, ramp(h - 1 - j));
      if (k >= 1) continue;
      const o = j * w + i;
      const lost = p.alpha[o] * (1 - k);
      // Booked to the nearest closed margin, so a corner is not counted twice.
      let side = null;
      let best = Infinity;
      if (live.left && i < best) { best = i; side = 'left'; }
      if (live.right && w - 1 - i < best) { best = w - 1 - i; side = 'right'; }
      if (live.top && j < best) { best = j; side = 'top'; }
      if (live.bottom && h - 1 - j < best) { best = h - 1 - j; side = 'bottom'; }
      if (side) p.closeBandCover[side] += lost;
      p.alpha[o] *= k;
      for (let c = 0; c < 3; c++) p.rgb[o * 3 + c] *= k;
    }
  }
  for (const key of Object.keys(p.closeBandCover)) {
    p.closeBandCover[key] = round(p.closeBandCover[key] / Math.max(1e-9, total), 5);
  }
  p.closeBandDeg = round(band * onScreen, 4);
  closedTiles++;
  closedEdges += Object.values(live).filter(Boolean).length;
}
if (closedTiles > 0) {
  process.stdout.write(`close: ${closedEdges} margin(s) of ${closedTiles} tile(s) carried more `
    + `than ${CLOSE_FLOOR} of coverage where the quad ends and were brought to nothing over `
    + `${CLOSE_DEG} deg of drawn sky\n`);
}

// ------------------------------------------------- the quads, and the ramp
//
// A piece is drawn on the quads its silhouette is cut into and on nothing else,
// so the coverage outside them is light the frame does not write. The rule is
// tools/clouds/cloud-compose.mjs's, and it now hands back the factor that makes
// the two agree: one where the cloud is, ramped to nothing across the ring of
// cells the union takes beyond it. Applied HERE — after the density, before the
// gain and before the level — the coverage the atlas holds outside the quads is
// exactly nought, and the boundary is an edge rather than a step.
//
// The colour goes with it because the atlas is premultiplied.
for (const p of pieces) {
  const spanU = p.width * p.degPerTexel;
  const spanV = p.height * p.degPerTexel;
  p.sil = silhouette(p.alpha, p.width, p.height, spanU, spanV);
  let cut = 0;
  for (let i = 0; i < p.width * p.height; i++) {
    const k = p.sil.keep[i];
    if (k >= 1) continue;
    cut += p.alpha[i] * (1 - k);
    p.alpha[i] *= k;
    for (let c = 0; c < 3; c++) p.rgb[i * 3 + c] *= k;
  }
  p.quadCut = cut;
}

// ------------------------------------------------------------- the packing
//
// Skyline, widest first, on the transcoder's own grid of four. A tile whose
// left edge falls at an odd column shares its first block column with whatever
// is beside it, so the same texels packed at a different offset come back
// different — which is why every tile is cut to a multiple of four texels and
// the gutter is eight.

function packAtlas(tiles, width, height) {
  const skyline = new Int32Array(width).fill(GUTTER);
  const order = [...tiles].sort((a, b) => (b.width * b.height) - (a.width * a.height));
  for (const tile of order) {
    const span = tile.width + GUTTER;
    let bestX = -1;
    let bestY = Infinity;
    for (let x = 0; x + span <= width; x += 4) {
      let y = 0;
      for (let k = 0; k < span; k++) y = Math.max(y, skyline[x + k]);
      if (y < bestY) { bestY = y; bestX = x; }
    }
    if (bestX < 0 || bestY + tile.height + GUTTER > height) return null;
    tile.rect = {
      x: bestX, y: bestY, width: tile.width, height: tile.height,
    };
    for (let k = 0; k < span; k++) skyline[bestX + k] = bestY + tile.height + GUTTER;
  }
  return { bottom: Math.max(...skyline) };
}

let atlas = null;
for (let side = 512; side <= MAX_SIDE && !atlas; side *= 2) {
  for (const [w, h] of [[side, side / 2], [side, side]]) {
    if (h < 256) continue;
    if (packAtlas(pieces, w, h)) { atlas = { width: w, height: h }; break; }
  }
}
if (!atlas) {
  console.error(`these ${pieces.length} piece(s) do not fit in ${MAX_SIDE} square at `
    + `${TEXEL_DEG} deg a texel: raise --texelDeg or pack fewer`);
  process.exit(1);
}

// ------------------------------------------------- from a photograph's light
//                                                     to this world's light
//
// A PLATE IS NOT IN THE WORLD'S UNITS AND CANNOT BE ASSUMED TO BE.
//
// What a photograph carries is a ratio: cloud against the sky it was shot
// against, under an exposure nobody recorded. What the fragment writes is scene
// radiance, which the frame's own tone curve then maps to a picture. Put a
// plate into the atlas at the scale that made its brightest cloud the same
// number as the old atlas's brightest cloud and the ratio is broken: measured
// on the first delivery, a veil at two parts in two hundred and fifty five came
// out adding as much light as the whole sky behind it, and the far half of
// every bank read as a pale blocky rash over deep blue.
//
// So every plate is calibrated by its OWN SKY. The background this chain
// estimated is the one thing in the photograph whose counterpart in the world
// is known — src/core/sky.js draws that sky from a model, and the model is
// here — so each piece is multiplied by the ratio of the two, and its cloud
// arrives standing the same distance above the world's sky as it stood above
// its own. Nothing else in the chain is allowed to touch the level, and the
// two paragraphs here are the only place a photograph's exposure is dealt with.
//
// AND THE SKY IT IS COMPARED AGAINST IS THE ONE IT WILL STAND IN FRONT OF.
// This dome is not one colour: at two degrees of elevation it is three times
// the radiance it has at fifteen, and the whole of that fall happens inside the
// band the weather occupies. Calibrating every piece against one height put the
// deck on the horizon three times too dark for the sky behind it — measured on
// the first delivery, cloud at 121 display levels against a sky at 125, a Weber
// contrast of minus 0.03 where the reference reads plus 0.22, and metro14
// stopped calling it cloud at all. So a piece is calibrated at the height its
// composition stands it at, and the fallback for a piece nothing stands is the
// one the command line names.

const preset = JSON.parse(readFileSync(`${ROOT}assets-src/sky/sky.json`, 'utf8')).day;
if (!preset) throw new Error('assets-src/sky/sky.json carries no day preset');
const sunAzimuth = (roster.world?.sun?.azimuth ?? -9.5) + 90;
// WHY THE AIRLIGHT IS NOT TAKEN OUT OF THE SKY A PLATE IS CALIBRATED AGAINST,
// which is a question this unit answered with algebra after answering it twice
// with screenshots.
//
// This dome is three times the radiance at two degrees of elevation that it has
// at fifteen, and most of that rise is AIRLIGHT: light the air between the eye
// and the weather scatters into the ray, which a cloud out there is behind
// rather than in front of. So calibrating a piece against the whole of it looks
// like double counting, and the obvious fix is to calibrate against the dome
// with the airlight removed and let the term in src/world/clouds.js put it
// back. Built and shot, that fix takes the frame's coverage from 21 per cent to
// 13 and every band's contrast with it, and the algebra says why. What the
// frame writes at full coverage is
//
//     pixel = (1 − v)·C + v·sky
//
// with v the airlight share, so asking the pixel to stand at the ratio r the
// plate photographed gives C = sky·(r − v)/(1 − v), which is LARGER than r·sky
// and not smaller. Calibrating against sky·(1 − v) makes it smaller by the same
// factor twice over.
//
// And the useful half of that identity: (1 − v)·C + v·sky with C = sky(r−v)/(1−v)
// is r·sky at EVERY elevation — the airlight cancels out of what the frame
// shows. A photograph's own cloud-to-sky ratio is a complete description of
// what the frame is to draw, and no consistent model of the air in front of it
// can change that. Which is why aerialBaked for this roster is one: not because
// the plates were measured to carry all of this world's air, but because their
// ratio already answers the question the term would answer, and any other value
// would count it twice. What the term is for is the sky the ratio is taken
// against MOVING — a dusk, a night — and that is where it earns its place.
const domeLevelAt2 = (elevation, azimuth) => {
  const c = domeAt(preset, elevation, azimuth);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const domeLevelAt = (elevation) => domeLevelAt2(elevation, sunAzimuth);
// AND THE HEIGHT A PIECE STANDS AT IS WHERE ITS CLOUD IS, not where its window
// is.
//
// A window is cut round a body with room to spare — the hero's is 38 degrees
// tall and its cloud fills 64 per cent of it — and the composition states where
// the WINDOW's middle goes. Calibrating at that height puts a bank whose cloud
// sits in the lower half of its own window into a sky higher and darker than
// the one it will actually hang against, and the whole piece comes out too dark
// by that ratio: measured on this roster the two differ by up to three degrees
// of elevation, which on this dome is a fifth of the level. So each piece
// reports where its own coverage sits inside its window, as a fraction of the
// half height, and every height below is taken there.
for (const p of pieces) {
  let sum = 0;
  let weight = 0;
  for (let j = 0; j < p.height; j++) {
    const t = 1 - 2 * (j + 0.5) / p.height;
    for (let i = 0; i < p.width; i++) {
      const a = p.alpha[j * p.width + i];
      sum += a * t;
      weight += a;
    }
  }
  p.centroidT = weight > 0 ? sum / weight : 0;
}
const centroidOf = (piece, elevation, scale) => elevation
  + Math.atan(piece.centroidT * piece.head.halfV * (scale === undefined ? 1 : scale)) / DEG;
const byId = new Map(pieces.map((p) => [p.head.id, p]));
const standsAt = new Map();
for (const stand of composition.placements || []) {
  const piece = byId.get(stand.tile);
  if (!piece) continue;
  const list = standsAt.get(stand.tile) || [];
  list.push(centroidOf(piece, stand.elevation, stand.scale));
  standsAt.set(stand.tile, list);
}
for (const t of composition.tiles || []) {
  const piece = byId.get(t.id);
  if (piece && t.elevation !== undefined && !standsAt.has(t.id)) {
    standsAt.set(t.id, [centroidOf(piece, t.elevation, t.scale)]);
  }
}
// AND WHAT A PHOTOGRAPH'S OWN EXPOSURE COULD NOT RECORD.
//
// The rule above puts a plate's cloud the same distance over this world's sky
// as it stood over its own, and that is the whole of what the pixels can
// answer. What they cannot answer is the camera's shoulder: a photograph of a
// backlit bank has its highlights compressed by a curve nobody wrote down, so
// the ratio it carries is a floor on the ratio the cloud had. Measured on the
// first delivery of this composition against the reference, at the reference
// pose: a cloud body at 159/164/168 display levels against the reference's
// 186/198/210, and a Weber contrast against its own sky of 0.19 to 0.38 where
// the reference reads 0.28 to 0.58.
//
// So the roster carries one gain, per channel, stated where anybody can see it
// and applied to every plate alike. Per channel because the same measurement
// reads the reference's body at r/g 0.941 and b/g 1.065 against this delivery's
// 0.969 and 1.028 — a warmth of three per cent, which is the difference between
// a bank at noon and one at five o'clock and is exactly what the committente
// named. It is NOT fitted to the reference's absolute level: that photograph's
// sky is forty display levels brighter than this dome, and matching the number
// rather than the ratio would mean lighting the cloud for a sky it is not
// standing in.
// AND WHAT EACH CAMERA'S OWN SHOULDER TOOK OUT, plate by plate.
//
// The rule above puts a plate's cloud the same distance over this world's sky
// as it stood over its own, and the gain below corrects, once and for every
// plate alike, for the fact that a photograph's highlights are compressed by a
// curve nobody wrote down. Both of those treat the roster as one camera, and it
// is not one camera: measured on the pieces themselves — the unpremultiplied
// colour over the plate's own background, at the texels where the coverage is
// over a half — the cloud-to-sky ratio the nine plates carry runs from 1.62 to
// 3.13. That is a factor of nearly two between one bank and another, and it is
// not the weather: every one of these is a backlit cumulus under a sun thirty
// to thirty five degrees up, and the ratio a cumulus core stands at above its
// own sky does not depend on which of them was photographed.
//
// It matters because the composition casts the plates by SHAPE. The deck on the
// horizon and the middle band are cordone and medi-a, which carry 1.65 and
// 1.74; the band at six degrees of elevation is theirs, and it is the band the
// delivery reads flattest in — 0.12 of Weber contrast against the reference's
// 0.31, while the band at fourteen, which medi-b fills at 2.27, reads 0.30
// against 0.28. The frame's contrast follows the plate's ratio, band by band.
//
// So each plate is brought onto one ratio, and the ratio is the roster's own
// median rather than anything of the reference's: this is a CALIBRATION between
// sources, not a level. Its weighted effect on the whole delivery is a little
// over one per cent of luminance — the plates that come up are paid for by
// frammenti coming down — which is what tells it apart from the gain below.
const shoulderOf = (plate) => {
  const entry = (roster.plates || []).find((e) => e.id === plate) || {};
  return Math.max(0.5, Number(entry.shoulder ?? 1));
};

// AND WHAT THE SAME SCALAR DROPPED, which is the COLOUR of the sky a piece is
// stood in front of.
//
// The gain two paragraphs up is a LUMINANCE: the dome's level at the height the
// composition stands a piece at, over the level of the sky the plate was shot
// against. It carries the level and it carries nothing else — whatever height a
// piece is then stood at, it keeps the chromaticity of the sky it was calibrated
// against, which for this roster is `world.plateSky`, the dome read at five
// degrees.
//
// For a piece that stands where the weather stands that is harmless, and it is
// harmless because it was MEASURED to be: `cloudLevel` was fitted family by
// family over five bands from six degrees of elevation to twenty two, against a
// reference whose top row is at twenty seven, and it closes the delivered
// chromaticity on that reference to within one per cent. Everything the fit
// could see stands under twenty four degrees.
//
// A SHEET OF HIGH CIRRUS DOES NOT. Stood at forty degrees and over, it is lit,
// in the frame, by the white balance of the horizon and set against the blue of
// the zenith — and no measurement in the delivery objects, because there are no
// reference pixels up there to object with. What the eye gets is a near neutral
// filament on deep blue, which reads as veining in marble and not as ice.
//
// So a plate may ask for the residue back: `skyBalance` is how much of it it
// takes, and the residue itself is not a choice — it is the chromaticity of the
// dome at the height the piece stands, over the chromaticity of the sky the
// packing calibrated it against, normalised on green so that it is a colour and
// never a second level. Nought is exactly the behaviour before this line
// existed, which is why no plate that does not ask changes by a bit.
//
// AND THE SHARE IS ONE, WHICH IS NOT A CHOICE.
//
// The unit that added this lever took a half and said so: a veil's light is
// neither all sun nor all sky, nothing in the delivery could split the two, and
// half in the exponent is the geometric mean of the two skies. That was honest
// and it was also answering the wrong question. The residue is not a share of
// the veil's light — it is an error in the CALIBRATION, and an error is either
// taken out or left in. At one, a plate's cloud keeps exactly the colour it had
// RELATIVE TO THE SKY IT WAS PHOTOGRAPHED AGAINST, transposed onto the dome at
// the height the composition stands it at, which is the whole of what the
// packing was trying to do in the first place; at a half it keeps the geometric
// mean of that and of the horizon's white balance, which is nothing in
// particular. So the veils ask for one, and what is left of their warmth against
// this zenith is the plate's own — a white cirrus over a blue sky is warmer than
// the sky, and no calibration is entitled to take that away.
//
// Nought is still exactly the behaviour before this line existed, and it is what
// every body carries: a calibration at six to twenty two degrees is a
// calibration against the sky those bodies actually stand in.
const plateSkyRgb = world.plateSky || [1, 1, 1];
const skyBalanceOf = (plate) => {
  const entry = (roster.plates || []).find((e) => e.id === plate) || {};
  return Math.min(1, Math.max(0, Number(entry.skyBalance ?? 0)));
};
const tintAt = (elevation, share) => {
  if (!share) return [1, 1, 1];
  const dome = domeAt(preset, elevation, sunAzimuth);
  return [0, 1, 2].map((k) => (
    (dome[k] / dome[1]) / (plateSkyRgb[k] / plateSkyRgb[1])) ** share);
};

const cloudLevel = world.cloudLevel || [1, 1, 1];
for (const p of pieces) {
  const heights = standsAt.get(p.head.id);
  p.standsAt = heights && heights.length
    ? heights.reduce((t, v) => t + v, 0) / heights.length : CALIBRATION_ELEVATION;
  const s = p.head.skyColour || [0.08, 0.20, 0.42];
  const plateLevel = 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
  p.gain = domeLevelAt(p.standsAt) / Math.max(1e-6, plateLevel);
  p.shoulder = shoulderOf(p.head.plate);
  p.skyBalance = skyBalanceOf(p.head.plate);
  p.tint = tintAt(p.standsAt, p.skyBalance);
  for (let i = 0; i < p.rgb.length; i += 3) {
    for (let k = 0; k < 3; k++) p.rgb[i + k] *= p.gain * p.shoulder * p.tint[k] * cloudLevel[k];
  }
}
const worldLevel = domeLevelAt(CALIBRATION_ELEVATION);

// THE SAME SKY, AS A TABLE, so the runtime can finish what the line above can
// only start.
//
// The gain over there is one number for a piece that is twenty degrees tall,
// and this dome changes by a factor of three across twenty degrees: a bank
// calibrated at the height of its middle arrives too dark at its base and too
// bright at its crown, in exactly the ratio of the two skies. src/world/
// clouds.js divides that ratio out per corner of the silhouette, which costs an
// attribute and no arithmetic per fragment, and this is the table it needs.
//
// AVERAGED OVER THE BEARING. The dome is a function of two angles and this is a
// function of one, so the aureole — a factor of about one and a fifth between
// the sun's bearing and away from it — is not in it. Putting it in would mean a
// gain that depends on where a piece stands round the compass, which is a
// second table and a second interpolation for a correction the composition can
// carry itself by choosing the height it stands a piece at.
const SKY_PROFILE = { from: -4, step: 1, count: 45 };
const skyProfile = [];
for (let i = 0; i < SKY_PROFILE.count; i++) {
  const el = SKY_PROFILE.from + i * SKY_PROFILE.step;
  let sum = 0;
  for (let az = 0; az < 360; az += 10) sum += domeLevelAt2(el, az);
  skyProfile.push(round(sum / 36, 6));
}

// How much of the world's air a plate has already got baked into it.
//
// It cannot be read off the plate. The obvious reading — how far a body's own
// core falls short of closing — is circular here, because the matte holds a
// region enclosed by cloud opaque by topology and every bank in this roster
// comes back with a core at exactly one. What CAN be said is that a photograph
// of a bank tens of kilometres off is a photograph through that much air, so
// the share is neither nought nor one, and the number below is FITTED against
// the reference's own rise of contrast with height — the same measurement the
// four constants of the term itself were fitted to. Stated here, per delivery,
// so a source shot on a clearer day
// changes a line of the roster rather than a line of the renderer.
const aerialBaked = world.aerialBaked === undefined ? 1 : world.aerialBaked;

// --------------------------------------------------------------- the level
//
// The brightest thousandth is allowed to clip rather than crushing every other
// texel's precision to protect it — the same rule and the same percentile the
// existing atlas was written under.
//
// AND WHY IT CAN BE HELD WHERE THE LAST DELIVERY PUT IT (`--holdLevel`).
//
// There is ONE scale for the whole quad, so a colour changed on one plate
// rescales the texels of every other plate by the ratio of the two scales.
// Measured on a retouch of three plates out of fifteen: the scale moved by
// sixteen parts in a hundred thousand and put a difference of one level in 255
// on half a per cent of the texels of all twenty eight tiles that were not
// touched. Nothing in the frame can see that — but it is also the difference
// between a delivery that can SAY it changed three plates and one that can only
// say it meant to, because a tile whose texels are identical encodes to
// identical UASTC blocks (they are cut to a multiple of four and gutter eight
// apart for exactly this reason) and one whose texels moved does not.
//
// So a targeted retouch may state the scale the last atlas was written at and
// let this run's own measurement be reported beside it rather than applied. It
// is not for a fresh delivery: hold a scale far from the material's own and the
// brightest thousandth stops being a thousandth, which is why the run prints
// what actually clipped.
const all = [];
for (const p of pieces) {
  for (let i = 0; i < p.width * p.height; i++) {
    if (p.alpha[i] > 0.02) all.push(Math.max(p.rgb[i * 3], p.rgb[i * 3 + 1], p.rgb[i * 3 + 2]));
  }
}
all.sort((a, b) => a - b);
const measuredPeak = all.length ? all[Math.floor(all.length * 0.999)] : 1;
const heldPeak = Number(opt('holdLevel', 0));
const peak = heldPeak > 0 ? heldPeak : measuredPeak;
// Printed to full precision, and always, because the manifest can only carry it
// rounded and `--holdLevel` needs the number the last run actually divided by.
process.stdout.write(`level measured ${measuredPeak}\n`);
if (heldPeak > 0) {
  process.stdout.write(`level held at ${peak}, `
    + `x${round(measuredPeak / peak, 6)} off this run's own\n`);
}

const image = Buffer.alloc(atlas.width * atlas.height * 4);
let clipped = 0;
for (const p of pieces) {
  for (let j = 0; j < p.height; j++) {
    for (let i = 0; i < p.width; i++) {
      const o = j * p.width + i;
      const d = ((p.rect.y + j) * atlas.width + p.rect.x + i) * 4;
      for (let k = 0; k < 3; k++) {
        const v = p.rgb[o * 3 + k] / peak;
        if (v > 1) clipped++;
        image[d + k] = Math.max(0, Math.min(255,
          Math.round(linearToSrgb(Math.max(0, Math.min(1, v))) * 255)));
      }
      image[d + 3] = Math.max(0, Math.min(255, Math.round(p.alpha[o] * 255)));
    }
  }
}

mkdirSync(OUT, { recursive: true });
const imagePath = join(OUT, 'cloud-sprites.png');
const bytes = await writeCleanPng(image, { ...atlas, channels: 4 }, imagePath);

// AND THE COVERAGE A SECOND TIME, ON ITS OWN.
//
// It is the same numbers as the fourth channel above and it is written twice on
// purpose, because the two go to the eye by different roads. The colour is a
// photograph and travels through a block codec, which is right for a
// photograph; the coverage is a SILHOUETTE, and a block codec cannot hold a
// block that is part cloud and part nothing. Measured on the delivery this unit
// inherited: the codec lifted 20 697 texels of clear sky inside the windows
// above nought, up to 22 of 255, and every one of them is a fragment the frame
// blends over open blue in squares four texels across — the staircase round
// every bank. Raising the codec's quality to its maximum moves that by nothing.
//
// The fourth channel STAYS where it is: a runtime that does not get the
// coverage file reads it exactly as before, and a delivery is then still one
// file that draws.
const coverPath = join(OUT, 'cloud-cover.png');
const coverage = Buffer.alloc(atlas.width * atlas.height);
for (let i = 0; i < coverage.length; i++) coverage[i] = image[i * 4 + 3];
const coverBytes = await writeCleanPng(coverage, { ...atlas, channels: 1 }, coverPath);

// ------------------------------------------------------------ the manifest

const tiles = pieces.map((p) => {
  const spanU = p.width * p.degPerTexel;
  const spanV = p.height * p.degPerTexel;
  // The same cut the coverage was ramped to, not a second one: two calls could
  // come to disagree, and a quad that disagrees with the coverage under it is
  // the staircase this ramp exists to close.
  const sil = p.sil;
  return {
    id: p.head.id,
    kind: p.head.kind || 'library',
    rect: p.rect,
    azimuth: p.head.azimuth,
    elevation: p.head.elevation,
    halfU: round(Math.tan(spanU / 2 * DEG), 6),
    halfV: round(Math.tan(spanV / 2 * DEG), 6),
    sunSource: p.head.sunSource,
    degPerTexel: round(p.degPerTexel, 6),
    parts: sil.parts.map((q) => q.map((x) => round(x, 4))),
    cells: sil.cells,
    areaRatio: round(sil.areaRatio, 4),
    borderAlpha: p.head.borderAlpha,
    fadeBandCover: p.head.fadeBandCover,
    // What the plate's window carried where the ATLAS's own tile ends, and what
    // closing it cost — nought on every margin that was quiet.
    closeEdgePeak: p.closeEdgePeak,
    closeBandCover: p.closeBandCover,
    plate: p.head.plate,
  };
});

const sun = world.sun || { azimuth: -9.5, elevation: 34 };
const manifest = {
  // WHAT KIND OF DELIVERY THIS IS, and it is the one flag the runtime reads.
  //
  // The sprite manifest has carried two different things: pieces cut out of the
  // reference's own photograph, and — here — pieces ingested from plates. They
  // are drawn by the same material and are the same shape of file, so nothing
  // in the numbers tells them apart; what tells them apart is which chain
  // wrote it. src/world/clouds.js reads this word to decide whether the
  // generated atlas, which used to take precedence over anything photographic,
  // still does.
  source: 'plates',
  // See the note over `aerialBaked` above: what this delivery is NOT asked to
  // pay of the world's own air, because its pixels already paid it to a camera.
  aerialBaked,
  atlas: {
    width: atlas.width,
    height: atlas.height,
    levelScale: round(peak, 5),
    // Whether this delivery carries the coverage on its own beside the colour.
    // Read by nothing at runtime — the presence of the texture is what the
    // renderer goes by — and written so a delivery can be told apart from the
    // ones packed before the silhouette got its own channel.
    cover: 'cloud-cover.png',
  },
  counts: {
    tiles: tiles.length,
    plates: new Set(tiles.map((t) => t.plate)).size,
    placements: (composition.placements || []).length,
    standing: (composition.tiles || []).length + (composition.placements || []).length,
  },
  sun: {
    elevation: sun.elevation,
    azimuth: sun.azimuth,
    vector: basisOf(sun.azimuth, sun.elevation).forward.map((v) => round(v, 5)),
  },
  shade: {
    ambient: SHADE_AMBIENT,
    diffuse: SHADE_DIFFUSE,
    forward: SHADE_FORWARD,
    normalSlope: NORMAL_SLOPE,
  },
  // Degrees of sky one texel of this atlas spans, which is the decision this
  // step exists to take and the first thing to look at if the sky reads soft.
  sampling: {
    texelDeg: TEXEL_DEG,
    // Where a plate asked for a coarser rate than the atlas's own, and why: see
    // the note over `texelDegOf`. Each tile's `degPerTexel` is the truth; this
    // is here so the decision is readable without dividing two numbers.
    texelDegNote: 'degrees of sky a texel spans WHERE THE PIECE STANDS. A tile is cut '
      + 'at this over the largest scale the composition ever stands it at, so that every '
      + 'piece is equally sharp on the screen rather than inside its own window; a plate '
      + "may ask for coarser still in the roster's own texelDeg and the coarser of the "
      + "two wins. Each tile's degPerTexel below is what it was actually cut at.",
    // What the dome is at the height a piece nothing stands is calibrated
    // against, and — per piece — the height its composition put it at and what
    // its own sky had to be multiplied by to stand there.
    calibratedAt: CALIBRATION_ELEVATION,
    worldSky: round(worldLevel, 5),
    // The dome's own level against height, averaged over the bearing, so the
    // runtime can finish a calibration this step can only take at one height.
    skyProfile: { from: SKY_PROFILE.from, step: SKY_PROFILE.step, values: skyProfile },
    gains: Object.fromEntries(pieces.map((p) => [p.head.id,
      {
        at: round(p.standsAt, 2),
        gain: round(p.gain, 4),
        density: p.density,
        shoulder: p.shoulder,
        // How much of the background's own colour this piece was given back,
        // and what that came to per channel. Nought and [1,1,1] is the chain
        // before the lever existed; see the note over `tintAt`.
        skyBalance: p.skyBalance,
        tint: p.tint.map((v) => round(v, 4)),
        // Where this piece's own coverage sits inside its window, as a
        // fraction of its half height: what the runtime needs to work out the
        // height each PLACEMENT of it actually hangs its cloud at.
        centroidT: round(p.centroidT, 4),
      }])),
  },
  tiles: [...(composition.tiles || []).map((t) => {
    const base = tiles.find((x) => x.id === t.id);
    if (!base) throw new Error(`the composition stands "${t.id}", which this packing does not hold`);
    return {
      ...base,
      kind: t.kind || 'mass',
      azimuth: t.azimuth ?? base.azimuth,
      elevation: t.elevation ?? base.elevation,
      ...(t.scale === undefined ? {} : { scale: t.scale }),
    };
  }), ...tiles.filter((t) => !(composition.tiles || []).some((c) => c.id === t.id))],
  placements: composition.placements || [],
};
writeFileSync(join(OUT, 'clouds.json'), JSON.stringify(manifest, null, 2));

process.stdout.write(`${pieces.length} piece(s) at ${TEXEL_DEG} deg a texel -> `
  + `${atlas.width}x${atlas.height}, ${(bytes / 1024).toFixed(0)} KiB of colour + `
  + `${(coverBytes / 1024).toFixed(0)} KiB of coverage, `
  + `${clipped} texel(s) over the level\n`);
const byIdOut = new Map(pieces.map((p) => [p.head.id, p]));
for (const t of manifest.tiles) {
  const p = byIdOut.get(t.id);
  const total = p ? p.alpha.reduce((s, a) => s + a, 0) + p.quadCut : 1;
  process.stdout.write(`  ${t.id.padEnd(14)} ${`${t.rect.width}x${t.rect.height}`.padEnd(10)} `
    + `at ${String(t.rect.x).padStart(5)},${String(t.rect.y).padStart(5)}  `
    + `${(2 * Math.atan(t.halfU) / DEG).toFixed(1)}x${(2 * Math.atan(t.halfV) / DEG).toFixed(1)} deg  `
    + `cover ${(t.areaRatio * 100).toFixed(0)}% of its window in ${t.cells} cells, `
    + `ramp took ${(100 * (p ? p.quadCut : 0) / Math.max(1e-9, total)).toFixed(3)}%\n`);
}
process.stdout.write(`atlas -> ${imagePath}\nmanifest -> ${join(OUT, 'clouds.json')}\n`);
