import { read, readJson, reporter, selfTest } from './lib.mjs';

// THE PIXEL THE WORLD IS DRAWN INTO, THE RANGE IT HAS TO CARRY, AND THE FLOOR IT
// HAS TO CLOSE.
//
// WHAT THIS PREVENTS. The scene's render target is the largest single item in
// this frame: at 1920 by 870 with four samples it is cleared, written and
// resolved every frame, and on a machine whose video memory IS the system's
// memory that is most of the world's stage. Halving its pixel is the cheapest
// time in this file -- measured over six poses at the high tier, the frame's
// median goes from 20.96 to 16.14 ms at pose P and from 27.65 to 21.70 at the
// worst pose in the world, with not one vertex touched. The temptation that
// comes with it is the defect this guard exists for: the two four byte formats
// a driver hands over most readily, RGBA8 and RGB10_A2, are NORMALISED -- they
// carry nought to one and nothing else.
//
// AND NOTHING IN THAT BUFFER IS A PICTURE. It is LIGHT: the exposure, the AgX
// curve and both grades run in the composite, downstream of it, and the bloom
// takes its source from it at a threshold of 0.72 of those same units. In them
// assets-src/sky/sky.json puts the sun's disc at a HUNDRED and the horizon near
// one. A buffer that stops at one does not dim those highlights, it deletes
// them, and what goes with them is the halo the whole picture was graded
// against: measured at pose P, the bloom is worth 23.2 levels on the front of
// monolith 03 and 29.4 on 05 through a buffer that carries light, and 4.7 and
// 9.8 through RGBA8 -- four fifths of the bloom gone, nothing red anywhere, and
// a frame that merely looks a little flat.
//
// SO THE RULE IS NOT "FOUR BYTES", IT IS "A RANGE". A format may sit in the
// table -- the measurement that chose the pixel had to be able to allocate the
// normalised ones by name in order to weigh them -- but only a format that
// carries light may be SHIPPED, which is to say may be reached by a tier or by
// the fallback a driver's refusal walks down.
//
// AND THE OTHER END OF THE SAME QUESTION IS THE BLACK. The grade cube is fitted
// and then written into eight bit pixels, so its answer to a fragment with NO
// LIGHT IN IT is not exactly black: the shipped cube's corner texel rounds to
// (0, 0, 1), and one level of blue with no red beside it is a COLOUR, in exactly
// the places that have no light of their own -- a shadowed joint of the paving,
// the underside of a tuft. So post.js anchors the cube on its own black, and
// this guard holds it there: it reads the corner of the shipped cube, works out
// what a black fragment would develop to with the anchor and without it, and
// fails if the source has stopped taking it off.
//
// THE SYNTHETIC SCENE, AND WHY IT IS ARITHMETIC AND NOT A BROWSER. The question
// asked here is not "does the frame look right", it is "does this pixel still
// hold the numbers this world writes into it, and does it still give back
// nothing where nothing was written". Those numbers are in sky.json, in the
// shipped cube and in post.js, and the encoding of each candidate is a
// specification -- so the ladder is quantised here, by hand, and the guard is
// held to BOTH DIRECTIONS: the shipped pixel returns every rung of the ladder
// and closes at nought, and a normalised pixel is CAUGHT losing the top of it
// while an unanchored cube is CAUGHT lifting the bottom.

const POST = 'src/core/post.js';
const QUALITY = 'src/core/quality.js';
const CUBE = 'public/assets/grade-lut.png';

/** The formats post.js knows how to ask a driver for, as it states them. */
export function formatsOf(text) {
  const open = text.indexOf('const TARGET_FORMATS = [');
  if (open < 0) return [];
  const body = text.slice(open, text.indexOf('\n];', open));
  const found = [];
  const entry = /name:\s*'([A-Za-z0-9_]+)'[\s\S]*?bytes:\s*(\d+)[\s\S]*?highDynamicRange:\s*(true|false)[\s\S]*?shipped:\s*(true|false)/g;
  for (let m = entry.exec(body); m; m = entry.exec(body)) {
    found.push({
      name: m[1],
      bytes: Number(m[2]),
      highDynamicRange: m[3] === 'true',
      shipped: m[4] === 'true',
    });
  }
  return found;
}

/** What each tier asks for: its name, its sample count and its pixel. */
export function tiersOf(text) {
  const open = text.indexOf('export const TIERS = [');
  if (open < 0) return [];
  const body = text.slice(open, text.indexOf('\n];', open));
  const found = [];
  const entry = /id:\s*'([a-z]+)'[\s\S]*?samples:\s*(\d+),[\s\S]*?sceneFormat:\s*'([A-Za-z0-9_]+)'/g;
  for (let m = entry.exec(body); m; m = entry.exec(body)) {
    found.push({ id: m[1], samples: Number(m[2]), sceneFormat: m[3] });
  }
  return found;
}

/** Whether the grade still takes the cube's own black off its own answer. */
export const cubeIsAnchored = (text) => /vec3 black = texture2D\(tLut,[\s\S]{0,200}?\(graded - black\) \/ max\(1\.0 - black/.test(text);

// --------------------------------------------------------- the synthetic scene
//
// One rung for each thing this world actually writes into the buffer, taken from
// the files that state them rather than from memory.
export function lightLadder(sky, postText) {
  const threshold = Number(/bloomThreshold:\s*([\d.]+)/.exec(postText)[1]);
  return [
    { what: 'the ramp at the zenith', value: sky.day.ramp.zenith[0] },
    { what: 'the ramp at the horizon', value: sky.day.ramp.horizon[2] },
    { what: 'the meadow, around a fifth', value: 0.2 },
    { what: "the bloom's own threshold", value: threshold },
    { what: 'the radiance of the horizon', value: Math.max(...sky.horizonRadiance) },
    { what: 'the sky at its own intensity', value: Math.max(...sky.horizonRadiance) * sky.intensity },
    { what: "the sun's disc", value: sky.day.disc.level },
  ];
}

/**
 * One value through one format's pixel, and back.
 *
 * The two packed floats have no sign bit: five bits of exponent with a bias of
 * fifteen over a mantissa of six bits in red and green and five in blue, so the
 * coarse channel is the one asked. The normalised ones are a clamp and a round,
 * which is the whole of the point.
 */
export function roundTrip(format, value) {
  if (format === 'RGBA8') return Math.round(Math.min(1, Math.max(0, value)) * 255) / 255;
  if (format === 'RGB10_A2') return Math.round(Math.min(1, Math.max(0, value)) * 1023) / 1023;
  const mantissa = format === 'RGBA16F' ? 10 : 5;
  const steps = 2 ** mantissa;
  const top = 2 ** 15 * (2 - 1 / steps);
  if (value <= 0) return 0;
  if (value > top) return top;
  const exponent = Math.floor(Math.log2(value));
  return 2 ** exponent * Math.round((value / 2 ** exponent) * steps) / steps;
}

/** Whether a format returns the whole ladder, and how badly it does not. */
export function carries(format, ladder, tolerance) {
  return ladder.map((rung) => {
    const back = roundTrip(format, rung.value);
    const error = Math.abs(back - rung.value) / rung.value;
    return { ...rung, back, error, ok: error <= tolerance };
  });
}

/**
 * What a fragment with no light in it comes out as, in eight bit levels.
 *
 * Everything upstream of the cube leaves an exact nought alone -- the exposure
 * is a multiply, AgX clamps its own foot to nought and the sRGB encode is linear
 * through the origin, all three verified on this machine with the world hidden
 * and the buffer left at its own clear -- so the black point of the chain IS the
 * cube's answer to black, and the anchor is what takes it off.
 */
export const blackFloor = (corner, anchored) => (anchored ? [0, 0, 0] : corner);

const sky = readJson('assets-src/sky/sky.json');
const postText = read(POST);
const ladder = lightLadder(sky, postText);
// A blue channel of five mantissa bits steps by one part in thirty two at the
// worst; anything inside that is the pixel doing what it says it does.
const TOLERANCE = 1 / 32;

const sharp = (await import('sharp')).default;
const cube = await sharp(`${(await import('./lib.mjs')).REPO_ROOT}/${CUBE}`)
  .removeAlpha().raw().toBuffer({ resolveWithObject: true });
const corner = [cube.data[0], cube.data[1], cube.data[2]];

if (process.argv.includes('--self')) {
  const formats = formatsOf(postText);
  const qualityText = read(QUALITY);
  selfTest('guard-buffer', [
    {
      what: 'a normalised format promoted into the shipping ladder is caught',
      caught: !formatsOf(postText.replace(
        "name: 'RGBA8',\n    bytes: 4,\n    highDynamicRange: false,\n    shipped: false,",
        "name: 'RGBA8',\n    bytes: 4,\n    highDynamicRange: false,\n    shipped: true,",
      )).filter((f) => f.shipped).every((f) => f.highDynamicRange),
    },
    {
      what: 'a tier switched to RGBA8 is caught',
      caught: !tiersOf(qualityText.replace("sceneFormat: 'R11F_G11F_B10F'", "sceneFormat: 'RGBA8'"))
        .every((t) => (formats.find((f) => f.name === t.sceneFormat) || {}).highDynamicRange),
    },
    {
      what: 'a tier whose multisampling was quietly dropped to two is caught',
      caught: tiersOf(qualityText.replace(
        "    scale: 1,\n    samples: 4,\n    sceneFormat: 'R11F_G11F_B10F',\n    bloom: 'half',",
        "    scale: 1,\n    samples: 2,\n    sceneFormat: 'R11F_G11F_B10F',\n    bloom: 'half',",
      )).some((t) => t.samples !== ({ oltre: 4, alto: 4, medio: 4, basso: 2 })[t.id]),
    },
    {
      what: "RGBA8 is caught losing the sun's disc",
      caught: carries('RGBA8', ladder, TOLERANCE).some((r) => !r.ok),
    },
    {
      what: 'RGB10_A2 is caught losing it too, ten bits or not',
      caught: carries('RGB10_A2', ladder, TOLERANCE).some((r) => !r.ok),
    },
    {
      what: 'the shipped pixel carries the whole ladder',
      caught: carries('R11F_G11F_B10F', ladder, TOLERANCE).every((r) => r.ok),
    },
    {
      what: 'and so does the rung below it',
      caught: carries('RGBA16F', ladder, TOLERANCE).every((r) => r.ok),
    },
    {
      what: 'an anchor taken back out of the grade is caught',
      caught: !cubeIsAnchored(postText.replace(
        'return clamp((graded - black) / max(1.0 - black, vec3(1e-4)), 0.0, 1.0);',
        'return graded;',
      )),
    },
    {
      what: 'and the cube it was taken out of does lift the black, so the check bites',
      caught: blackFloor(corner, false).some((c) => c > 0),
    },
    {
      what: 'while the anchored chain closes at nought',
      caught: blackFloor(corner, cubeIsAnchored(postText)).every((c) => c === 0),
    },
  ]);
}

const report = reporter('guard-buffer -- the scene buffer, its range, and the floor of the chain');

const formats = formatsOf(postText);
const tiers = tiersOf(read(QUALITY));

report.check(formats.length >= 2, `${POST} states a table of scene formats`, `${formats.length} of them`);
report.check(formats.some((f) => f.shipped), 'at least one of them is shipped');
for (const format of formats.filter((f) => f.shipped)) {
  report.check(format.highDynamicRange,
    `the shipped ${format.name} carries light and not a picture`, `${format.bytes} bytes`);
}
report.line(`  ${formats.filter((f) => !f.shipped).map((f) => f.name).join(', ') || 'none'} `
  + 'in the table and out of the ladder: allocatable by name for a measurement, never by fallback');

// WHAT THE TIERS ARE HELD TO, LITERALLY. The multisampling is four everywhere but
// the lowest tier, and that is a question standing with the committente and not a
// lever anybody may spend quietly; the pixel is the same on every tier because
// the range of the light is not a tier's to change.
const WRITTEN = {
  oltre: { samples: 4, sceneFormat: 'R11F_G11F_B10F' },
  alto: { samples: 4, sceneFormat: 'R11F_G11F_B10F' },
  medio: { samples: 4, sceneFormat: 'R11F_G11F_B10F' },
  basso: { samples: 2, sceneFormat: 'R11F_G11F_B10F' },
};
report.check(tiers.length === Object.keys(WRITTEN).length,
  `${QUALITY} states every tier`, tiers.map((t) => t.id).join(', '));
for (const tier of tiers) {
  const want = WRITTEN[tier.id];
  report.check(Boolean(want), `the tier ${tier.id} is one this guard knows`);
  if (!want) continue;
  report.check(tier.samples === want.samples,
    `the tier ${tier.id} draws with ${want.samples} samples`, `${tier.samples}`);
  report.check(tier.sceneFormat === want.sceneFormat,
    `the tier ${tier.id} draws into ${want.sceneFormat}`, tier.sceneFormat);
  const known = formats.find((f) => f.name === tier.sceneFormat);
  report.check(Boolean(known) && known.shipped && known.highDynamicRange,
    `and that pixel is one ${POST} ships`, known ? `${known.bytes} bytes` : 'not in the table');
}

// ------------------------------------------------ the two directions, in light
report.line("  the world's own ladder of light, from assets-src/sky/sky.json and post.js, "
  + `through each pixel (tolerance ${(TOLERANCE * 100).toFixed(1)} %)`);
for (const name of [...new Set(tiers.map((t) => t.sceneFormat))]) {
  for (const rung of carries(name, ladder, TOLERANCE)) {
    report.check(rung.ok, `${name} returns ${rung.what}`,
      `${rung.value} -> ${Number(rung.back.toPrecision(6))} (${(rung.error * 100).toFixed(2)} %)`);
  }
}
for (const name of formats.filter((f) => !f.highDynamicRange).map((f) => f.name)) {
  const lost = carries(name, ladder, TOLERANCE).filter((r) => !r.ok);
  report.check(lost.length > 0,
    `${name} is still caught losing the top of it, which is what makes the checks above mean anything`,
    `${lost.length} of ${ladder.length} rungs: ${lost.map((r) => r.what).join('; ')}`);
}

// ------------------------------------------------- and the floor, in both ways
const anchored = cubeIsAnchored(postText);
report.line(`  the shipped cube's own corner is (${corner.join(', ')}) of 255: `
  + 'what a fragment with no light in it would develop to if nothing took it off');
report.check(anchored, `${POST} anchors the grade on the cube's own black`);
report.check(blackFloor(corner, anchored).every((c) => c === 0),
  'so a linear nought comes out of the chain as nought', `(${blackFloor(corner, anchored).join(', ')})`);
report.check(blackFloor(corner, false).some((c) => c > 0),
  'and the same cube unanchored does lift it, so the check above is not vacuous',
  `(${blackFloor(corner, false).join(', ')})`);

report.end();
