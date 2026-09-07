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

// The two files the paving is made of, and the second one MOVED. The fragment
// used to live in the layer that hung the corridor's own surface; the corridor
// is columns of V1's disc now and the fragment that paints their tops is in the
// voxel families' own material file. The question this guard asks did not move
// with it: a fragment that reaches for a baked atlas is the same defect
// wherever it is written, and it is a defect this world can only find by
// looking.
const FILES = ['src/world/path.js', 'src/world/voxel/material.js'];
const LAYER = 'src/world/layers/v1-suolo.js';

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

/**
 * Whether anything in a fragment multiplies the light rather than the pigment.
 *
 * CHANGED BY U-SENT-2, and the change is what src/world/face-light.js was
 * written for. Its own note says it in as many words: «a material may bend the
 * sun term between the two -- the masonry does, for its own relief -- and that
 * is why faceLightOf() takes the pair rather than the normal». The corridor's
 * tiles stand up to a centimetre proud (E-DECISIONI10 S1), and what a piece's
 * own shadow takes away is the BEAM and not the colour of the stone: a shadow
 * written into the albedo would be a stone that is dark at midnight as well as
 * at noon.
 *
 * So a write to the pair passes when the line names the producer OR one of the
 * corridor's declared relief uniforms, and is a second opinion otherwise. What
 * the rule still refuses is the whole of what it ever protected: a fragment
 * that decides for itself where the sun is, and the JOINT moved onto the light.
 */
const RELIEF = /uRelief[A-Z]/;

// AND A SECOND BENDER, WHICH IS THE MAT'S OWN SHADOW, DECLARED THE SAME WAY.
//
// U-ERBA-2 built what E-DECISIONI9.3 asked for -- «ombre vere che seguono il
// sole» -- as a map baked at worldgen along the bearing the seal carries, and a
// fragment standing under that line has less SUN. That is a material bending
// the pair it was given, which is exactly what face-light.js says a material
// may do and exactly what the corridor's relief already does above.
//
// SO IT IS ALLOWED THE SAME WAY AND NOT BY WIDENING THE RULE. The line has to
// name one of the shadow's own uniforms -- the map or how much sun survives
// under it -- so what still cannot happen is the thing this guard exists for: a
// fragment that decides for itself where the sun is. The bearing is not in this
// file at all; it is in assets-src/sky/sky.json, under the seal, and the map is
// baked from there.
const SHADE = /uShade[A-Z]|tShade/;

// AND A THIRD, WHICH IS THE LIGHT BY PLACE, DECLARED THE SAME WAY AGAIN.
//
// U-ZONE-1 painted one picture of how dark each square metre of this world
// stands -- the law of the seats the world publishes times the residual
// measured off the reference -- and delivered it as a SEAT: `zoneAt(xz)`, one
// function, one texture, read by the field and by the three programs of
// ../../src/world/vegetation.js. Residues 3 and 4 of E-ZONE1 are the two that
// were not reading it, and one of them is this corridor: «il sentiero del
// bersaglio e' scuro dove il prato e' scuro».
//
// AND IT IS THE LIGHT AND NOT THE PIGMENT, WHICH IS WHY IT COMES THROUGH HERE
// AND NOT THROUGH jointIsPigment. A zone is how much of the sky and the sun
// reach a square metre of ground; a stone that stood in it would be pale again
// at noon and dark again at dusk, which is what a light does and what a colour
// cannot. The joint went the other way for the same reason and the two rules
// are one rule read from both ends.
//
// SO IT IS ALLOWED THE SAME WAY THE MAT'S SHADOW IS AND NOT BY WIDENING THE
// RULE: the line has to name the seat's own function or its own uniform, and
// never with the joint riding along on it. What still cannot happen is the
// thing this guard exists for -- a fragment that decides for itself where the
// sun is -- because `zoneAt` does not know where the sun is either: it is a
// picture of the ground, in XZ, painted offline and gated by guard-zone.
const ZONE = /zoneAt\s*\(|uZone|tZone/;

export function lightsTheJoint(source) {
  const bad = [];
  // Every assignment whose left hand side is the light or the terms.
  const re = /\b(light|terms|sun|sky)\s*(\*=|=[^=])/g;
  let hit;
  while ((hit = re.exec(source))) {
    const line = source.slice(hit.index, source.indexOf('\n', hit.index));
    // The light being MADE, once, out of the producer.
    if (/faceLight|faceLightOf|faceTerms/.test(line)) continue;
    // Or the pair being bent by the relief, through a uniform that says so --
    // and never with the joint riding along on it.
    if (RELIEF.test(line) && !/uJoint/.test(line)) continue;
    // Or the pair being bent by the mat's own shadow, through a uniform that
    // says so, and never with the joint riding along on it either.
    if (SHADE.test(line) && !/uJoint/.test(line)) continue;
    // Or the light being multiplied by the place it stands in, through the
    // seat's own name, and never with the joint riding along on that either.
    if (ZONE.test(line) && !/uJoint/.test(line)) continue;
    bad.push({ line, at: lineOf(source, hit.index) });
  }
  return bad;
}

/**
 * Whether the joint's own darkening is still a pigment.
 *
 * This is the half of the old rule that did NOT move. The relief is light and
 * the soil in a slot is colour, and the two are separated here so neither can
 * drift into the other while the fragment gets longer: every line that names
 * uJointDark has to be assigning the albedo or declaring the uniform.
 */
export function jointIsPigment(source) {
  const bad = [];
  const re = /uJointDark/g;
  let hit;
  while ((hit = re.exec(source))) {
    const from = source.lastIndexOf('\n', hit.index) + 1;
    const line = source.slice(from, source.indexOf('\n', hit.index));
    // The albedo being darkened, the uniform being declared in the GLSL, and
    // the same uniform being bound in the JS beside it: those three, and the
    // reason the third is here is that this reads a FILE and not a shader.
    if (/^\s*(albedo\s*\*?=|uniform\s|float\s+\w+\s*=|uJointDark:|u\.uJointDark)/.test(line)) continue;
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
      what: 'a relief bending the pair through its own uniform is let through',
      caught: lightsTheJoint('  terms.x *= 1.0 - uReliefShade * step;').length === 0,
    },
    {
      what: 'a fragment deciding for itself where the sun is, is caught',
      caught: lightsTheJoint('  sun = max(dot(n, vec3(0.0, 1.0, 0.0)), 0.0);').length > 0,
    },
    {
      what: 'the joint riding onto the light behind a relief uniform is caught',
      caught: lightsTheJoint('  terms *= 1.0 - uJointDark.x * uReliefWall;').length > 0,
    },
    {
      what: 'a joint darkening left on the albedo is not',
      caught: jointIsPigment('  albedo *= 1.0 - inSlot * uJointDark.x;').length === 0,
    },
    {
      what: 'and the same darkening moved onto the light is',
      caught: jointIsPigment('  terms *= 1.0 - inSlot * uJointDark.x;').length > 0,
    },
    {
      what: 'the light multiplied by the zone, through the name of the seat, is let through',
      caught: lightsTheJoint('  light *= zoneAt(vWorld.xz);').length === 0,
    },
    {
      what: 'and a zone the seat did not paint -- a second opinion about the place -- is caught',
      caught: lightsTheJoint('  light *= 1.0 - 0.4 * smoothstep(2.6, 0.0, footDistance);').length > 0,
    },
    {
      what: 'the joint riding onto the light behind the zone is caught too',
      caught: lightsTheJoint('  light *= zoneAt(vWorld.xz) * (1.0 - uJointDark.x);').length > 0,
    },
    {
      what: 'a fetch hidden in a comment is still not a fetch',
      caught: names(code('// the old terrain-light is gone\nvec3 c = albedo;'),
        ATLASES).length === 0,
    },
    {
      what: 'the delivered fragment is none of those',
      caught: !writesTerms(clean) && lightsTheJoint(clean).length === 0
        && jointIsPigment(clean).length === 0
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
report.check((/faceLight\s*\(/.test(fragment)
    || (/faceTerms\s*\(/.test(fragment) && /faceLightOf\s*\(/.test(fragment)))
  && /FACE_LIGHT_GLSL/.test(fragment),
  'it asks src/world/face-light.js for them instead, whole or as a pair it bends');

const pigment = jointIsPigment(fragment);
report.check(pigment.length === 0,
  'a joint is a pigment: every line that darkens it multiplies the albedo',
  pigment.map((h) => `line ${h.at}`).join(' | '));

const joint = lightsTheJoint(fragment);
report.check(joint.length === 0,
  'and what bends the light is the relief, the shadow of the mat and the zone, each through its own uniforms',
  joint.map((h) => `line ${h.at}`).join(' | '));

// AND THE CORRIDOR ACTUALLY READS THE ZONE, which is the other half of the
// same sentence: a rule that only says «if you touch the light, name the seat»
// is satisfied by a fragment that never touches the light at all, and that is
// precisely the state E-ZONE1 left this file in. The paving's own fragment has
// to multiply by it, and it has to be handed the pair through zoneUniforms()
// rather than through a sampler of its own.
report.check(/light\s*\*=\s*zoneAt\s*\(/.test(fragment),
  'the paving and the cubes take the light by place, through zoneAt',
  'E-ZONE1 residues 3 and 4: the seat is published and one line reads it');
report.check(/zoneUniforms\s*\(/.test(fragment) && /zoneGlsl\s*\(/.test(fragment),
  'and they take it from the ONE seat, not from a sampler of their own');

// AND THE DOOR THE SHADER CANNOT SEE. A layer asks for its assets by id, and an
// atlas handed to a material through that door is an atlas whatever the GLSL
// says.
//
// READ OUT OF THE SOURCE AND NOT IMPORTED, deliberately. Importing the register
// walks every layer in the world, and half of them pull a JSON in the way a
// browser allows and a Node script does not -- so a guard that imported it would
// be a guard that cannot run. It also asks a better question this way: what the
// FILE says, which is what a reviewer reads and what a merge carries.
// AND THE LAYER IT READS IS V1'S NOW, because the corridor is one of the three
// families V1's disc draws and an asset is declared where it is eaten. That
// layer asks for the ground's four AS WELL as the paving's three, so the check
// is on the three and the print names them: what would be a finding is an
// atlas arriving through the door that hands the PAVING its maps.
const PAVING_MAPS = ['path-joint', 'path-tone', 'path-grain'];
const needs = [...code(read(LAYER)).matchAll(/needs:\s*\[([^\]]*)\]/g)]
  .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((q) => q[1]));
const carried = needs.filter((id) => PAVING_MAPS.includes(id));
const asked = carried.filter((id) => ATLASES.includes(id));
report.check(asked.length === 0 && carried.length === PAVING_MAPS.length,
  'the paving is handed three maps through the layer, and no atlas of the old world',
  `it is handed ${carried.join(', ') || 'nothing'}`);

// The two maps the corridor DOES carry are the paving's own, and neither is a
// bake: one is a ruler and the other a field of stones. Named here so that the
// coordinator can read this guard as the evidence for the half-waiver rather
// than having to take the absence of a word for it.
report.line('  what it does carry: '
  + `${carried.join(', ')} -- two rulers and a tile, none of them a bake`);

report.end();
