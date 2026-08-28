// Bake the cloud volumes and write their channels.
//
//   node tools/clouds/bake-volumes.mjs <piece> [<piece> ...]
//   node tools/clouds/bake-volumes.mjs grande medio torre
//
// NOT wired into any build script, and it must not be: a piece takes a quarter
// of an hour of one core and the output is committed as an asset, not produced
// on the way to a deploy.
//
// WHAT A PIECE LEAVES BEHIND. A cloud that has to be lit from any direction
// cannot ship its light baked into its colour, so a piece is delivered as the
// quantities the light does NOT depend on, plus one channel per sun plane that
// it does:
//
//   alpha      coverage, 16 bit. Whole by construction: no cut, ever.
//   ao         the fraction of the sky the point can see, 16 bit.
//   normal     the surface the billow has, 8 bit per axis, biased to 0.5.
//   lit-NN     transported sun energy for plane NN, 16 bit over 0..1.
//   prod.png   a PREVIEW of the production plane through cloud-tone.mjs.
//
// Sixteen bits and not eight for the scalars, on purpose: the shaded side of a
// mass sits at an illumination near 0.03, where an 8 bit step is an eighth of
// the value and stairsteps visibly in exactly the region the shaded side is.
//
// WHAT THIS IS NOT. It is not the shipped atlas. Packing pieces into an atlas,
// choosing which planes survive and how the runtime interpolates between them
// is the next step, and it needs the runtime's own budget to decide it.

import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { generate, SUNS } from './cloud-volume.mjs';
import { arcParams, planesFor, sunVec } from './cloud-arc.mjs';
import {
  fits, piece, PROD_SUN, sizes, SURF_MIX,
} from './cloud-pieces.mjs';
import {
  EXPOSURE, AMB_BASE, AMB_RANGE, meanL, palette, render,
} from './cloud-tone.mjs';
import { writeChannel, writeNormal } from './cloud-channels.mjs';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = `${ROOT}assets-src/clouds/volumes`;
const SIZE = Number(process.env.CLOUD_SIZE || 512);
const SS = Number(process.env.CLOUD_SS || 2);

// The seeds the delivered pieces were cut with. A seed is part of a piece's
// identity — two pieces from one seed are twins, and the atlas has a rule
// against twins — so they are written down rather than drawn.
const SEEDS = { grande: 4021, medio: 7719, torre: 3313 };

// The arc the light actually travels lives in `cloud-arc.mjs`, and the delivered
// ring is its FINE sampling: every 7.5 degrees, twenty-nine directions.
//
// It used to be written out here, and the pole azimuth written here was wrong —
// the circle it described did not pass through the sun the world is lit by, and
// missed it by 8.32 degrees. The constant now has one home, and
// `tools/clouds/check-arc.mjs` asserts the property that was silently false.
const PRODUCTION_RING = planesFor(arcParams().fine, 'ring');

// The production plane first, then the twelve the campaign has been read on.
// Plane 0 is the one every fit was made on, and every reader below assumes it.
//
// THIS SET IS NOT THE PRODUCTION RING, and the difference is now measured
// rather than assumed. These thirteen are a COVERAGE set: they were chosen to
// prove that a mass has a lit side and a shaded one from every quarter, and for
// that they are enough — the ring reads thirteen distinct luminances spanning 54
// levels, monotone in phase angle apart from two pairs that are not orderings at
// all (`side-34-90` and `side-34-m90` sit at the SAME phase, 97.2 degrees, on
// opposite flanks of a body that is not symmetric).
//
// What they are not is a ring a runtime can INTERPOLATE along, and the night
// trigger is what makes that the load-bearing question: the light has to run
// from a sun overhead through sunset and on to a moon, so the arc is a whole
// turn and not a daytime segment.
//
// The measurement is in `ladder6.mjs` of the session that tuned the sub-billows:
// one piece, twenty planes, each interior plane compared against the linear
// interpolation of its two neighbours — which is exactly the error of a bake
// that omitted it. Two findings, and the first is a trap avoided:
//
//   - the MEAN brightness is the wrong budget. Down the elevation sweep at the
//     backlit azimuth the mean moves by 0.01 to 1.4 levels a step while the
//     per-texel RMS moves by 3.2 to 12.8: the crown darkens and the underside
//     lights up, the picture turns over, and the average barely notices. A
//     spacing sized on the mean puts its planes furthest apart precisely where
//     the picture is changing fastest.
//   - the residual after interpolation goes as the square of the span, and the
//     worst rung measured is in azimuth through the side-lit quarter: a span of
//     96.6 degrees leaves 27.4 levels RMS. Which puts a 15 degree step at about
//     2.7 levels, an 18 degree step at 3.8, and a 27.7 degree step — which is
//     what THIRTEEN planes over a full turn comes to — at about 9.
//
// So thirteen planes do not cover the wider arc: they are two and a half times
// outside a four-level net. Twenty at 18 degrees clear it; twenty-four at 15
// degrees clear it with margin. Non-uniform spacing helps less than it looks:
// the calm stretches are the fully backlit and fully front-lit ends (0.23 to
// 0.45 RMS per degree) and the fast ones are the two side-lit quarters and the
// horizon crossing (0.80 to 1.12), so a ring of 12 degrees through the fast
// stretches and 24 through the calm ones comes to about twenty planes — the
// same count as the uniform 18, for more bookkeeping.
//
// The arc itself: elevation from +75 down to -12 degrees and azimuth all the way
// round. Below -12 the direct term is gone and the piece is its ambient, which
// is stored separately as `ao` and `normal` and needs no plane of its own — so
// night costs a different ambient magnitude and tint at runtime, not a re-bake.
//
// It is left switchable and NOT made the default because these pieces have been
// verified on the thirteen and on nothing else. Baking twenty-four is a
// production decision with a measured cost attached, not a default to slip in.
//
// Either way the production plane stays plane 0: the preview, the exposure fit
// and every reader below assume it. It is NOT a sample of the ring — it has no
// arc parameter, and a plane with no place in the parameter cannot be a sample
// of a curve in it — but it does now lie ON the ring's circle, between the
// samples at 52.5 and 60, which is the whole point of the pole azimuth in
// cloud-arc.mjs.
const PLANES = process.env.CLOUD_RING === 'production'
  ? [PROD_SUN, ...PRODUCTION_RING]
  : [PROD_SUN, ...SUNS.map((s) => ({ name: s.name, az: s.az, el: s.el }))];

// The channel format lives in cloud-channels.mjs and nowhere else. It used to be
// written here, by hand, asking sharp for a sixteen bit grayscale PNG through a
// `depth` option that sharp's raw INPUT does not have — so the files this tool
// produced were eight bit, three channel, and held the high and low bytes of
// every second sample side by side. Every comment about the shaded side needing
// sixteen bits was true and none of it was happening.
const rgba8 = async (data, w, h, path) => sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 4 } })
  .png({ compressionLevel: 9 }).toFile(path);

const { tint } = await palette();

for (const name of process.argv.slice(2)) {
  if (!SEEDS[name]) {
    console.error(`unknown piece "${name}"; have: ${Object.keys(SEEDS).join(', ')}`);
    process.exit(1);
  }
  const cfg = piece(name, SEEDS[name], PLANES.map((s) => ({ ...s, L: sunVec(s.az, s.el) })));

  // A sphere through the window wall is a cut silhouette, which is the one
  // defect this whole approach exists to make impossible. Refuse before paying
  // for the bake rather than discovering it in the montage afterwards.
  const bad = fits(cfg.shelves, cfg);
  if (bad.length) {
    console.error(`${name}: ${bad.length} sphere(s) outside the window; not baking`);
    process.exit(1);
  }
  const z = sizes(cfg.shelves);
  console.log(`${name}: ${z.n} spheres, diameter px min ${z.min.toFixed(0)} `
    + `med ${z.med.toFixed(0)} p75 ${z.p75.toFixed(0)} max ${z.max.toFixed(0)}`);

  const t0 = Date.now();
  const r = generate(cfg, cfg.suns, { ss: SS, out: SIZE, log: (m) => console.log(m) });
  console.log(`${name}: ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const dir = `${OUT}/${name}`;
  mkdirSync(dir, { recursive: true });
  const { width: w, height: h } = r;
  const K = cfg.suns.length;

  await writeChannel(r.alpha, w, h, `${dir}/alpha.png`);
  await writeChannel(r.ao, w, h, `${dir}/ao.png`);
  await writeNormal(r.normal, w, h, `${dir}/normal.png`);

  const plane = new Float32Array(w * h);
  for (let k = 0; k < K; k++) {
    for (let i = 0; i < w * h; i++) plane[i] = r.lit[i * K + k];
    await writeChannel(plane, w, h, `${dir}/lit-${String(k).padStart(2, '0')}.png`);
  }
  // The two surface channels ride with their planes: their weight is chosen at
  // shading time, so they cannot be folded into `lit` here without freezing it.
  // surfA is written only if the mix actually uses it. It is weighted by cA,
  // and cA is zero — sixteen planes of a channel multiplied by nothing is a
  // megabyte and a half a piece, and thirty-odd megabytes across a sky, of a
  // quantity no reader can distinguish from its absence. If a later fit gives
  // cA a value, this writes it again.
  if (r.surfA) {
    const bands = SURF_MIX.cA !== 0 ? [[r.surfA, 'surfA'], [r.surfB, 'surfB']] : [[r.surfB, 'surfB']];
    for (const [ch, tag] of bands) {
      for (let k = 0; k < K; k++) {
        for (let i = 0; i < w * h; i++) plane[i] = ch[i * K + k];
        await writeChannel(plane, w, h, `${dir}/${tag}-${String(k).padStart(2, '0')}.png`);
      }
    }
  }

  const img = render(r, { width: w, height: h, suns: cfg.suns }, 0, tint, SURF_MIX);
  await rgba8(img, w, h, `${dir}/prod-preview.png`);

  // Largest coverage anywhere on the window border. A whole silhouette needs
  // 0.000: anything else is a mass touching its own frame, which is the bite
  // this approach was adopted to abolish.
  let border = 0;
  for (let i = 0; i < w; i++) border = Math.max(border, r.alpha[i], r.alpha[(h - 1) * w + i]);
  for (let j = 0; j < h; j++) border = Math.max(border, r.alpha[j * w], r.alpha[j * w + w - 1]);

  writeFileSync(`${dir}/piece.json`, JSON.stringify({
    name,
    seed: SEEDS[name],
    width: w,
    height: h,
    degPerTexel: 0.0478,
    borderCoverage: Number((border * 255).toFixed(3)),
    tone: { exposure: EXPOSURE, ambient: { base: AMB_BASE, range: AMB_RANGE }, surfMix: SURF_MIX },
    encoding: {
      alpha: 'uint16 linear 0..1, high byte in red and low byte in green',
      ao: 'uint16 linear 0..1, high byte in red and low byte in green',
      normal: 'uint8 rgb, v = 2c - 1',
      lit: 'uint16 linear 0..1, one file per sun plane',
      surfB: 'uint16 linear 0..1, one file per sun plane',
    },
    window: {
      winW: cfg.winW, winH: cfg.winH, yMid: cfg.yMid, viewElDeg: cfg.viewElDeg,
    },
    suns: cfg.suns.map((s) => ({ name: s.name, az: s.az, el: s.el })),
    timings: r.timings,
  }, null, 2));

  console.log(`${name} -> ${dir}  border ${(border * 255).toFixed(3)}/255  `
    + `production plane mean L ${meanL(img, r.alpha).toFixed(1)}`);
}
