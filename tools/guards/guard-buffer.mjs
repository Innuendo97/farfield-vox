import { braceBody, read, readJson, reporter, selfTest } from './lib.mjs';

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

// ==========================================================================
// HOW THIS FILE READS A SOURCE, AFTER U-GUARDIA-3'S CENSUS.
//
// Every reader below used to end its slice on a piece of FORMATTING: the
// tables closed at the first `\n];` -- a bracket at column nought -- and
// `allocateCampo` closed at the first `\n  }`, which is a brace at exactly two
// spaces of indent. Indent one of those blocks by two more spaces, which is
// what wrapping it in anything would do, and the slice runs to the end of the
// file or stops at the wrong place, and the verdict is a coincidence either
// way. And `clearedToNothing` was worse than a slice: it demanded that two
// STATEMENTS BE ADJACENT, `\s*\n\s*` between them and nothing else, so a
// comment written between the clear and the bind -- the single most likely
// edit anybody would ever make there -- turned this guard red on a frame that
// had not changed.
//
// So a block is now closed by its own BRACKET, counted, and the two statements
// are asked in the only way that is actually the property: does the clear to
// nought happen BEFORE the bind, with nothing putting it back in between. That
// survives any number of lines written between them, which is what it should
// always have done.
// ==========================================================================

/** The span a bracket opens at, closed by counting its own kind. */
function bracketBody(text, from, open = '[', close = ']') {
  const at = text.indexOf(open, from);
  if (at < 0) return '';
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return text.slice(at + 1, i);
    }
  }
  return text.slice(at + 1);
}

/** The body of a function, taken for its name and closed by its own braces. */
function bodyOf(text, name) {
  const at = text.indexOf(`function ${name}(`);
  if (at < 0) return null;
  const open = text.indexOf('{', text.indexOf(')', at));
  return open < 0 ? null : braceBody(text, open);
}

/** The formats post.js knows how to ask a driver for, as it states them. */
export function formatsOf(text) {
  const open = text.indexOf('const TARGET_FORMATS =');
  if (open < 0) return [];
  const body = bracketBody(text, open);
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
  const open = text.indexOf('export const TIERS =');
  if (open < 0) return [];
  const body = bracketBody(text, open);
  const found = [];
  const entry = /id:\s*'([a-z]+)'[\s\S]*?samples:\s*(\d+),[\s\S]*?sceneFormat:\s*'([A-Za-z0-9_]+)'/g;
  for (let m = entry.exec(body); m; m = entry.exec(body)) {
    found.push({ id: m[1], samples: Number(m[2]), sceneFormat: m[3] });
  }
  return found;
}

/**
 * The ground's own buffer, as post.js asks the driver for it.
 *
 * THE SECOND BUFFER THE WORLD IS DRAWN INTO, and since U-CAMPO-3 the only other
 * one. The ray marched ground is two thirds of this frame and its cost tracks
 * its own pixel count to within a point -- measured over the resolution sweep:
 * at scale 0.75 the frame draws 56.3 % of the pixels and the field costs 55.2 %
 * of what it cost -- so it is drawn into a target of a fraction of a side and
 * put back at the frame's own pixel.
 */
export function campoBufferOf(text) {
  const body = bodyOf(text, 'allocateCampo');
  if (body === null) return null;
  return {
    format: (/format:\s*([A-Za-z0-9]+)/.exec(body) || [])[1] ?? null,
    type: (/type:\s*([A-Za-z0-9]+)/.exec(body) || [])[1] ?? null,
    nearest: /minFilter:\s*NearestFilter/.test(body) && /magFilter:\s*NearestFilter/.test(body),
    clearedToNothing: clearedToNothing(text),
  };
}

/**
 * Whether the ground's target is bound with the clear alpha already at nought.
 *
 * AND IT IS AN ORDER AND NOT AN ADJACENCY. three's own clear alpha is ONE
 * whenever the canvas is opaque, so a target left to the default arrives with
 * every texel already claiming to be ground -- and the recomposition, reading a
 * coverage of one where no ray found anything, paints the whole sky black. That
 * is not a hypothetical: it is what the first frame this pass ever drew did.
 *
 * What that costs is one property: WHEN THE TARGET IS BOUND, THE CLEAR ALPHA IS
 * NOUGHT. So the last `setClearAlpha` written before the bind is the one that
 * has to say nought, and how many lines stand between them is nobody's
 * business. The reader that stood here demanded the two statements touch, which
 * made a comment written between them a red.
 */
export function clearedToNothing(text) {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const bind = bare.indexOf('setRenderTarget(campoTarget)');
  if (bind < 0) return false;
  const before = [...bare.slice(0, bind).matchAll(/setClearAlpha\(\s*([^)]*?)\s*\)/g)];
  const last = before[before.length - 1];
  return Boolean(last) && Number(last[1]) === 0;
}

/** What each tier asks the ground's pixel to be, as a fraction of a side. */
export function campoScalesOf(text) {
  const open = text.indexOf('export const TIERS =');
  if (open < 0) return [];
  const body = bracketBody(text, open);
  const found = [];
  const entry = /id:\s*'([a-z]+)'[\s\S]*?campoScale:\s*([\d.]+)/g;
  for (let m = entry.exec(body); m; m = entry.exec(body)) {
    found.push({ id: m[1], campoScale: Number(m[2]) });
  }
  return found;
}

/** The ground's buffer has the fourth channel the scene's has not. */
export const groundCarriesCoverage = (campo) => Boolean(campo)
  && campo.format === 'RGBAFormat' && campo.type === 'HalfFloatType';

/** Bytes of colour per pixel OF THE FRAME that a buffer of this shape costs. */
export const bytesPerFramePixel = (bytes, scale, samples) => bytes * scale * scale
  * Math.max(1, samples);

// ============================================================== AT_TODAY, MEASURED
//
// 2026-09-08 (U-PERF-6), QUIET DESK: three runs of ninety readings a pose, high
// tier at three quarters of a side and low tier at a half, first person, veil
// off, the native arm and the null taken in the SAME opening.
//
// What the ground's march costs at a fraction of a side, against what the same
// march costs at the frame's own pixel -- the empirical half of the sentence
// over campoBufferOf, which until today rested on the FRAME scale sweep of
// E-PERF5 and not on this lever at all:
//
//   three quarters (high tier)   21.902 -> 9.480 ms    43.3 % of 56.3 % of the pixels
//   a half         (low tier)    11.115 -> 2.310 ms    20.8 % of 25.0 % of the pixels
//
// AND IT IS SUB PROPORTIONAL, which is the finding and not a rounding: a
// quarter of the pixels buys a fifth of the march, three quarters of a side
// buys under eight tenths of it. The reason is in the field's own prefilter --
// the blade, the joint and the edge follow the TARGET's pixel (guard-campo3),
// so a coarser target also takes a coarser step and leaves the cell sooner. A
// guard that asserted proportionality would be asserting the wrong law and
// would go red the day somebody improved the prefilter.
//
// The recomposition is not in this number: it is a full frame pass, it does not
// scale with the target, and it is gated where it belongs -- guard-cammino,
// on the whole quota.
const AT_TODAY = {
  0.75: { native: 21.902, march: 9.480, share: 9.480 / 21.902 },
  0.5: { native: 11.115, march: 2.310, share: 2.310 / 11.115 },
};

/** Does a march at this fraction of a side cost no more than its share of pixels? */
export function marchIsSubProportional(scale, add = 0) {
  const seen = AT_TODAY[scale];
  if (!seen) return true;
  return (seen.march + add) / seen.native <= scale * scale;
}


/**
 * Whether the grade still takes the cube's own black off its own answer.
 *
 * THE NAME IS DISCOVERED, NOT PINNED. What stood here matched one expression
 * with `black` written into it three times and a two hundred character window
 * between the halves: renaming the local, breaking the line, writing `1.` for
 * `1.0` or letting the expression grow past the window all turned it red on a
 * grade that had not moved. What the anchor IS, is a value sampled out of the
 * cube that is then both SUBTRACTED from the graded colour and used to
 * renormalise it -- so the reader takes every name the cube is sampled into and
 * asks which of them is used in both ways. A rename comes through; dropping
 * either half does not.
 */
export function cubeIsAnchored(text) {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const sampled = [...bare.matchAll(/\b([A-Za-z_]\w*)\s*=\s*texture2D\(\s*tLut\b/g)].map((m) => m[1]);
  return sampled.some((name) => new RegExp(`graded\\s*-\\s*${name}\\b`).test(bare)
    && new RegExp(`\\b1(?:\\.\\d*)?\\s*-\\s*${name}\\b`).test(bare));
}

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
  // THE TABLES ARE BENT AS VALUES AND NO LONGER AS TEXT. Every one of these
  // used to be a `replace` of a block of source with its indentation written
  // into the search string, so a table re-indented by two spaces turned the
  // injection into a silent no-op and the case into a coincidence. What is
  // read out of the source is a LIST; a list is what a defect is written into.
  const shippedCarryLight = (rows) => rows.filter((f) => f.shipped).every((f) => f.highDynamicRange);
  const tiersDrawIntoLight = (rows, table) => rows
    .every((t) => (table.find((f) => f.name === t.sceneFormat) || {}).highDynamicRange);
  // AND THE SAME SOURCE RE-INDENTED, so that the readers are shown to survive
  // exactly what they used to be broken by: every line pushed in by four
  // spaces, which is what wrapping a table in anything at all would do.
  const reindent = (text) => text.replace(/^/gm, '    ');
  selfTest('guard-buffer', [
    {
      // LA RICEVUTA DELLA MARCIA, provata nei due versi come ogni altro lettore
      // di questa cartella (E-GUARDIA4): oggi passa, e una marcia che smettesse
      // di essere sub proporzionale -- un prefiltro che non seguisse piu' il
      // bersaglio, una LOD che tornasse a nominare il pixel della tela -- non
      // passerebbe, che e' esattamente il difetto che rende inutile il
      // bersaglio ridotto senza rendere rosso nulla.
      what: 'the march measured today, which must NOT be called a defect',
      caught: marchIsSubProportional(0.75) && marchIsSubProportional(0.5),
    },
    {
      what: 'a march that stopped following the target\'s pixel and costs its share whole',
      caught: !marchIsSubProportional(0.75, 21.902 * 0.5625 - 9.480 + 0.01),
    },
    {
      what: 'and a half side whose march costs a quarter of the native, which is the same defect',
      caught: !marchIsSubProportional(0.5, 11.115 * 0.25 - 2.310 + 0.01),
    },
    {
      what: 'a scale nobody measured is not asserted about',
      caught: marchIsSubProportional(0.6, 1e6),
    },
    {
      what: 'a normalised format promoted into the shipping ladder is caught',
      caught: !shippedCarryLight(formats.map((f) => (f.name === 'RGBA8' ? { ...f, shipped: true } : f)))
        && shippedCarryLight(formats),
    },
    {
      what: 'and a brand new normalised pixel added to the ladder is caught too',
      caught: !shippedCarryLight([...formats,
        { name: 'RGBA4', bytes: 2, highDynamicRange: false, shipped: true }]),
    },
    {
      what: 'a tier switched to RGBA8 is caught',
      caught: !tiersDrawIntoLight(
        tiersOf(qualityText).map((t) => ({ ...t, sceneFormat: 'RGBA8' })), formats,
      ) && tiersDrawIntoLight(tiersOf(qualityText), formats),
    },
    {
      // THE INJECTION TURNED ROUND WITH THE ANSWER. It used to drop a tier from
      // four samples to two; two is what ships, so what has to be caught now is
      // a tier quietly RAISED -- which is the same lever spent in the other
      // direction, and the same 1.4 ms.
      what: 'a tier whose multisampling was quietly raised to four is caught',
      caught: tiersOf(qualityText).map((t, i) => (i === 0 ? { ...t, samples: 4 } : t))
        .some((t) => t.samples !== 2),
    },
    {
      // THE CASE THAT SAYS THE SLICES ARE NO LONGER PINNED TO A COLUMN. Both
      // tables closed on a bracket at column nought and `allocateCampo` on a
      // brace at two spaces; indented, all three used to come back empty or
      // wrong, and an empty table is a guard that agrees with everything.
      what: 'while both tables and the ground\'s buffer, re-indented by four spaces, read the same',
      caught: formatsOf(reindent(postText)).length === formats.length
        && tiersOf(reindent(qualityText)).length === tiersOf(qualityText).length
        && campoScalesOf(reindent(qualityText)).length === campoScalesOf(qualityText).length
        && campoBufferOf(reindent(postText)).format === campoBufferOf(postText).format
        && formats.length > 0 && tiersOf(qualityText).length > 0,
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
      what: "the ground's buffer stripped of its fourth channel is caught",
      caught: !groundCarriesCoverage({ ...campoBufferOf(postText), format: 'RGBFormat' })
        && groundCarriesCoverage(campoBufferOf(postText)),
    },
    {
      what: 'and one dropped to eight bits a channel, which loses the range and not the channel',
      caught: !groundCarriesCoverage({ ...campoBufferOf(postText), type: 'UnsignedByteType' }),
    },
    {
      what: 'and left to the clear alpha three gives an opaque canvas',
      caught: !clearedToNothing(postText.replace(/gl\.setClearAlpha\(0\);/, '')),
    },
    {
      what: 'and put back to one before the bind, which is the same defect written out',
      caught: !clearedToNothing(postText.replace(/gl\.setClearAlpha\(0\);/, 'gl.setClearAlpha(1);')),
    },
    {
      // AND THIS IS THE CASE THAT SAYS THE ADJACENCY IS GONE: four lines of
      // comment and a statement written between the clear and the bind, which
      // is the likeliest edit anybody will ever make there, and which used to
      // turn this guard red on a frame that had not changed.
      what: 'while five lines written between the clear and the bind change nothing',
      caught: clearedToNothing(postText.replace(/gl\.setClearAlpha\(0\);/,
        'gl.setClearAlpha(0);\n        // three clears an opaque canvas to an alpha of one, and the\n'
        + '        // coverage of this target lives in that very channel, so the\n'
        + '        // clear above is not tidiness: it is the whole of the mask.\n'
        + '        // See the recomposition in campo-material.js.\n'
        + '        const beforeTheBind = gl.getClearAlpha();'))
        && clearedToNothing(postText),
    },
    {
      what: 'a tier that stopped stating the ground\'s pixel is caught',
      caught: campoScalesOf(qualityText.replace(/ *campoScale: [\d.]+,[^\n]*\n/, ''))
        .length !== tiersOf(qualityText).length,
    },
    {
      what: 'an anchor taken back out of the grade is caught',
      caught: !cubeIsAnchored(postText.replace(/\(\s*graded\s*-\s*(\w+)\s*\)/, '(graded)')),
    },
    {
      what: 'and one that subtracts the black but forgets to renormalise on it',
      caught: !cubeIsAnchored(postText.replace(/max\(\s*1\.0\s*-\s*(\w+)/, 'max(vec3(1.0)')),
    },
    {
      // THE CASE THAT SAYS THE EXPRESSION IS NO LONGER PINNED: the local
      // renamed, the line broken in two and `1.0` written `1.`, none of which
      // is a change to the grade and all three of which used to be a red.
      what: 'while the same anchor renamed, rewrapped and written 1. instead of 1.0 still passes',
      caught: cubeIsAnchored(postText
        .replace(/\bvec3 black =/, 'vec3 foot =')
        .replace(/\(graded - black\) \/ max\(1\.0 - black, vec3\(1e-4\)\)/,
          '(graded - foot)\n      / max(1. - foot, vec3(1e-4))')),
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

// WHAT THE TIERS ARE HELD TO, LITERALLY.
//
// THE MULTISAMPLING IS TWO EVERYWHERE NOW, AND THE QUESTION THIS GUARD WAS
// HOLDING OPEN IS ANSWERED. It said: «four everywhere but the lowest tier, and
// that is a question standing with the committente and not a lever anybody may
// spend quietly». He spent it -- E-DECISIONI14 (2), «anti-aliasing: la
// raccomandazione», which is two samples on the borders of the cubes and the
// milliseconds that frees put on the sampling of the ray. What made it cheap to
// answer is that the ground stopped being triangles: multisampling is charged
// per triangle EDGE, and four samples were buying 3.75 ms of softness on
// 172 608 of them where they now buy 1.39 on the borders of one box.
//
// The pixel is still the same on every tier, because the range of the light is
// not a tier's to change, and THAT half of this table has not moved.
const WRITTEN = {
  oltre: { samples: 2, sceneFormat: 'R11F_G11F_B10F' },
  alto: { samples: 2, sceneFormat: 'R11F_G11F_B10F' },
  medio: { samples: 2, sceneFormat: 'R11F_G11F_B10F' },
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

// ------------------------------------------------- AND THE GROUND'S OWN BUFFER
//
// EVERYTHING ABOVE APPLIES TO IT, PLUS ONE THING THAT DOES NOT APPLY TO THE
// SCENE BUFFER AT ALL: it needs a FOURTH CHANNEL, and the reason is the very
// decision this file defends about the scene's own pixel.
//
// The field marches sub pixel rays and already computes what share of them
// found ground -- that is what would make the rim of the ridge against the sky
// a fraction rather than a step. It has never been spent, and the reason is
// three lines up this file: R11F_G11F_B10F has NO ALPHA, so the value goes
// nowhere the instant it is written and a pixel half covered by the ridge is
// drawn as though it were covered whole. On a buffer of a quarter of the pixels
// eight bytes of half float over a HALF of a side is two bytes per pixel of the
// frame, against the scene buffer's eight -- four bytes of packed float times
// the two samples it resolves. So the fourth channel is not a cost here, it is
// change from the pixels that were given back.
//
// AND THE COUNT HAS TO CARRY THE SAMPLES, which is where this guard first went
// wrong about its own subject: written without them it said four against four
// and a half and called the ground's buffer the dearer of the two. The scene
// buffer is multisampled and the ground's is deliberately not -- four samples
// on it were measured at 508 pixels of 1 668 480 (0.03 %) for a fifth of the
// pass, because every edge anybody can see in the meadow is decided by the ray
// marcher in the fragment and a coverage mask knows nothing about it.
const campo = campoBufferOf(postText);
const campoScales = campoScalesOf(read(QUALITY));
report.check(Boolean(campo), `${POST} states a buffer for the ground`);
if (campo) {
  report.check(groundCarriesCoverage(campo),
    "the ground's own buffer has the fourth channel the scene's has not",
    `${campo.format} / ${campo.type}: RGBA16F, which is where the coverage lives`);
  report.check(!formats.find((f) => f.name === 'R11F_G11F_B10F' && f.shipped)?.name
    || /R11F_G11F_B10F[\s\S]{0,900}?no alpha/.test(postText),
    'and the shipped scene pixel still has none, which is the reason for the line above');
  report.check(campo.nearest,
    'it is sampled at the texel: the recomposition does its own weighing, and a '
    + 'bilinear tap underneath would be a second filter nobody asked for');
  report.check(campo.clearedToNothing,
    'and it is cleared to NOTHING, against three\'s own opaque default of one');
}
report.check(campoScales.length === tiers.length,
  'every tier states what pixel the ground is marched at',
  campoScales.map((t) => `${t.id} ${t.campoScale}`).join(', '));
for (const tier of campoScales) {
  const want = WRITTEN[tier.id];
  const shape = formats.find((f) => f.name === (want || {}).sceneFormat);
  if (!shape) continue;
  const scene = bytesPerFramePixel(shape.bytes, 1, want.samples);
  const earth = bytesPerFramePixel(8, tier.campoScale, 0);
  report.check(earth < scene,
    `and at the tier ${tier.id} it costs less of the frame than the scene's own pixel does`,
    `${earth.toFixed(1)} bytes per frame pixel against ${scene.toFixed(1)}`);
  report.check(marchIsSubProportional(tier.campoScale),
    `and what the march costs at ${tier.campoScale} of a side is no more than the share of `
    + 'pixels it was given',
    `${(100 * (AT_TODAY[tier.campoScale] || {}).share).toFixed(1)} % of the native march `
    + `against ${(100 * tier.campoScale * tier.campoScale).toFixed(1)} % of the pixels`);
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
