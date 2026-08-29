import { lineOf, read, reporter, selfTest } from './lib.mjs';

// IS THE PATH STILL LIT BY AN ATLAS?
//
//   node tools/guards/guard-sentiero-luce.mjs
//   node tools/guards/guard-sentiero-luce.mjs --self
//
// WHY THIS EXISTS AND WHY IT IS A GUARD RATHER THAN A NOTE. The corridor was cut
// out of the ground for two reasons and one of them was the light: the ground's
// atlas is a legacy photorealistic bake made under a sun that has since moved,
// and `assets-src/terrain/terrain.json` sits in tools/lighting/sun-waivers.json
// as a debt shared by the ground session and this one, to be cleared jointly.
// This session's half of it is cleared by the corridor computing its own two
// terms instead of fetching a pair -- and a half-debt that is cleared by a habit
// rather than by a check is a half-debt that comes back the first time somebody
// needs a shadow in a hurry and reaches for a map.
//
// SO IT ASKS FOUR THINGS, and every one of them is a way the light could quietly
// come back:
//
//   * that the path's two files name no baked atlas at all, by id or by uniform;
//   * that the layer asks for no asset that is one, which is the door an atlas
//     would arrive through even if the shader never named it;
//   * that the terms the fragment lights with come from the ONE producer of
//     them, src/world/face-light.js, and not from a second copy of the same four
//     lines -- because two copies is how a block and the grass at its foot end
//     up disagreeing about the hour;
//   * and that nothing in the paving multiplies the LIGHT. A joint is soil and
//     soil is a pigment; put the darkening on the terms and the joint becomes a
//     function of the hour, and it reaches the one pair of numbers every other
//     guard in this world is weighed on.

const FILES = ['src/world/path.js', 'src/world/layers/v3-sentiero.js'];

// The atlases of the old world, by the name the runtime knows them under, and by
// the name a shader would sample them under. `tLight` and `bakedTerms` are the
// two ways the ground's own material reaches its bake.
const ATLASES = ['terrain-light', 'stairs-light', 'monolith-light', 'rock-light',
  'terrain-detail', 'terrain-path'];
const FETCHES = ['bakedTerms', 'tLight', 'BAKED_TERMS_GLSL'];

/**
 * A source with its prose taken out.
 *
 * WHY THE GUARD READS CODE AND NOT COMMENTS. The two files below have to be able
 * to SAY `terrain-path` and `terrain-detail`: the corridor displaces both, they
 * are declared in another session's fragment with a note pointing here, and the
 * only place that hand-over can be written down is a comment beside the assets
 * that replace them. A check that could not tell a sentence from a fetch would
 * make the honest note unwritable, and the way that gets resolved at two in the
 * morning is by deleting the note.
 *
 * Block comments and whole-line ones, which is where this project's prose lives.
 * A trailing comment on a line of code survives, and that is the right side to
 * err on: it is the half a sentence nobody explains an atlas in.
 */
export function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
}

/** Whether a source names any of a set of words, as whole words. */
export function names(source, words) {
  const found = [];
  for (const word of words) {
    const at = source.search(new RegExp(`\\b${word.replace(/-/g, '\\-')}\\b`));
    if (at >= 0) found.push({ word, line: lineOf(source, at) });
  }
  return found;
}

/**
 * Whether a fragment writes its own pair of terms instead of asking for one.
 *
 * The producer is `vec2(max(dot(n, uSunDir), 0.0), 0.5 + 0.5 * n.y)` and it
 * lives in one file. A second copy would not fail anything downstream -- it
 * draws very nearly the same picture today -- which is exactly why it has to be
 * refused here rather than found in a frame six weeks later.
 */
export function writesTerms(source) {
  return /vec2\s*\(\s*max\s*\(\s*dot\s*\(/.test(source)
    || /0\.5\s*\+\s*0\.5\s*\*\s*\w+\.y/.test(source);
}

/** Whether anything in a fragment multiplies the light rather than the pigment. */
export function lightsTheJoint(source) {
  const bad = [];
  // Every assignment whose left hand side is the light or the terms.
  const re = /\b(light|terms|sun|sky)\s*(\*=|=[^=])/g;
  let hit;
  while ((hit = re.exec(source))) {
    const line = source.slice(hit.index, source.indexOf('\n', hit.index));
    // The one legitimate write is the light being MADE, once, out of the
    // producer. Anything that bends it afterwards is a second opinion.
    if (/faceLight|faceLightOf|faceTerms/.test(line)) continue;
    bad.push({ line, at: lineOf(source, hit.index) });
  }
  return bad;
}

if (process.argv.includes('--self')) {
  const clean = code(read(FILES[1]));
  selfTest('guard-sentiero-luce', [
    {
      what: 'a path that asks for the ground atlas by name is caught',
      caught: names("needs: ['terrain-light']", ATLASES).length > 0,
    },
    {
      what: 'a path that samples a bake without naming it is caught',
      caught: names('vec3 t = bakedTerms(tLight, vUv);', FETCHES).length > 0,
    },
    {
      what: 'a fragment that writes its own pair of terms is caught',
      caught: writesTerms('vec2 terms = vec2(max(dot(n, uSunDir), 0.0), 0.5 + 0.5 * n.y);'),
    },
    {
      what: 'a joint darkening put on the light instead of the pigment is caught',
      caught: lightsTheJoint('  light *= 1.0 - inSlot * uJointDark.x;').length > 0,
    },
    {
      what: 'a fetch hidden in a comment is still not a fetch',
      caught: names(code('// the old terrain-light is gone\nvec3 c = albedo;'),
        ATLASES).length === 0,
    },
    {
      what: 'the delivered fragment is none of those',
      caught: !writesTerms(clean) && lightsTheJoint(clean).length === 0
        && names(clean, [...ATLASES, ...FETCHES]).length === 0,
    },
  ]);
}

const report = reporter('guard-sentiero-luce -- the path computes its light and fetches none of it');

let sources = '';
for (const file of FILES) {
  const source = code(read(file));
  sources += source;
  const atlas = names(source, ATLASES);
  const fetches = names(source, FETCHES);
  report.check(atlas.length === 0, `${file} names no baked atlas`,
    atlas.map((h) => `${h.word}:${h.line}`).join(' | '));
  report.check(fetches.length === 0, `${file} fetches no baked pair`,
    fetches.map((h) => `${h.word}:${h.line}`).join(' | '));
}

const fragment = code(read(FILES[1]));
report.check(!writesTerms(fragment),
  'the fragment does not write a second copy of the two terms');
report.check(/faceLight\s*\(/.test(fragment) && /FACE_LIGHT_GLSL/.test(fragment),
  'it asks src/world/face-light.js for them instead');

const joint = lightsTheJoint(fragment);
report.check(joint.length === 0,
  'nothing in the paving multiplies the light -- a joint is a pigment',
  joint.map((h) => `line ${h.at}`).join(' | '));

// AND THE DOOR THE SHADER CANNOT SEE. A layer asks for its assets by id, and an
// atlas handed to a material through that door is an atlas whatever the GLSL
// says.
//
// READ OUT OF THE SOURCE AND NOT IMPORTED, deliberately. Importing the register
// walks every layer in the world, and half of them pull a JSON in the way a
// browser allows and a Node script does not -- so a guard that imported it would
// be a guard that cannot run. It also asks a better question this way: what the
// FILE says, which is what a reviewer reads and what a merge carries.
const needs = [...code(read(FILES[1])).matchAll(/needs:\s*\[([^\]]*)\]/g)]
  .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((q) => q[1]));
const asked = needs.filter((id) => ATLASES.includes(id));
report.check(asked.length === 0,
  'the layer asks for no atlas of the old world',
  `it asks for ${needs.join(', ') || 'nothing'}`);

// The two maps the corridor DOES carry are the paving's own, and neither is a
// bake: one is a ruler and the other a field of stones. Named here so that the
// coordinator can read this guard as the evidence for the half-waiver rather
// than having to take the absence of a word for it.
report.line('  what it does carry: '
  + `${needs.join(', ')} -- a ruler and a tile, neither of them a bake`);

report.end();
