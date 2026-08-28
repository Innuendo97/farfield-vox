import { braceBody, lineOf, read, reporter, selfTest, walk } from './lib.mjs';

// THE LESSON OF THE BILLBOARD: A DRAW CALL THAT PAYS FOR NOTHING DRAWN.
//
// The night of the voxel demo was priced at +0.20 ms and actually cost +20 ms.
// TWO ORDERS OF MAGNITUDE, and the cause was one word: the halos and the cloud
// plates were single-sided quads turned to face the eye, and they were turned
// the wrong way round. They cost their hundred and ninety two draw calls in
// full and drew NO PIXELS AT ALL, so the profile said the night was free while
// the frame said otherwise -- and nobody could see the defect, because the way
// this defect looks is exactly like the feature not being there.
//
// WHAT THE CHECK IS, AND WHY IT IS THIS AND NOT A PIXEL COUNT. What is wanted is
// that an additive layer's DRAWN COVERAGE be worth its draws -- under one per
// cent of its own bounding box in frame is the case that has to fail. Counting
// those pixels needs a browser, one pose and one frame, and would answer for
// that pose only. Sidedness answers for EVERY pose and answers offline: a
// two-sided additive surface covers its box or is culled, and its coverage
// cannot be a function of which side the eye happens to be on. A single-sided
// one has a whole hemisphere of eye positions where the coverage is nought while
// the draw is charged in full, and there is nothing in a frame that shows it.
// So the offline form of the assertion is stronger than the pixel count, not
// weaker, and it is the form that runs on every commit.
//
// AND THE DEFAULT IS THE TRAP. three.js leaves `side` at FrontSide when it is
// not written, so the defect is not a wrong value -- it is a MISSING LINE. That
// is why a material with no `side` at all fails here exactly as a FrontSide one
// does.

/** Every material literal in a source, with the text of its own braces. */
export function materials(path, text) {
  const found = [];
  const pattern = /new\s+(\w*Material)\s*\(\s*\{/g;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    const open = text.indexOf('{', m.index + m[0].length - 1);
    found.push({
      path,
      line: lineOf(text, m.index),
      kind: m[1],
      body: braceBody(text, open),
    });
  }
  return found;
}

/** What an additive material says about the side of it the eye may be on. */
export function sidedness(material) {
  const stated = /\bside:\s*(\w+)/.exec(material.body);
  return stated ? stated[1] : 'FrontSide (three.js default, not written)';
}

export const isAdditive = (material) => /\bblending:\s*AdditiveBlending\b/.test(material.body);
export const drawsFromEitherSide = (material) => /\bside:\s*DoubleSide\b/.test(material.body);

if (process.argv.includes('--self')) {
  const injected = (side) => materials('injected', `
    const material = new ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      ${side}
      fog: false,
    });`)[0];
  const front = injected('side: FrontSide,');
  const silent = injected('');
  const both = injected('side: DoubleSide,');
  const opaque = materials('injected', 'new MeshBasicMaterial({ side: FrontSide });')[0];
  selfTest('guard-additiva', [
    { what: 'a single-sided additive material is caught', caught: isAdditive(front) && !drawsFromEitherSide(front) },
    {
      what: 'an additive material that never writes side at all is caught',
      caught: isAdditive(silent) && !drawsFromEitherSide(silent),
    },
    { what: 'and it is reported as the default rather than as absent', caught: /default/.test(sidedness(silent)) },
    { what: 'a two-sided additive material passes', caught: isAdditive(both) && drawsFromEitherSide(both) },
    { what: 'a single-sided material that is not additive is not this guard\'s business', caught: !isAdditive(opaque) },
  ]);
}

const report = reporter('guard-additiva -- every additive layer draws for the draws it costs');

const found = walk('src', (path) => path.endsWith('.js'))
  .flatMap((path) => materials(path, read(path)))
  .filter(isAdditive);

if (!found.length) {
  report.note('armed, none in scene: no material in src/ blends additively today');
  report.end();
}

report.line(`  ${found.length} additive material${found.length === 1 ? '' : 's'} in src/`);
for (const material of found) {
  report.check(drawsFromEitherSide(material),
    `${material.path}:${material.line} ${material.kind}`,
    drawsFromEitherSide(material)
      ? 'DoubleSide'
      : `${sidedness(material)} -- a hemisphere of eye positions where it draws nothing`);
}

report.end();
