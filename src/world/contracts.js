import { FIELD, heightAt, pathCoord, pathRun } from './terrain-field.js';
import { stairHeightAt as stairRunHeight } from './stairs.js';
import { PLATFORM } from './layout.js';

// THE CONTRACTS BETWEEN THE SESSIONS, AND THE ONLY DOOR BETWEEN THEM.
//
// WHAT THEY ARE FOR. Eight sessions rewrite eight pieces of this world at the
// same time, and four pairs of them have to agree about something in the middle:
// where the path cuts the ground, where the shell meets the disc, how high the
// worked stone is under a foot, and how much light the ground hands the grass
// standing on it. Every one of those was a direct import from one session's file
// into another's -- which is not a disagreement waiting to happen, it is a file
// two people own.
//
// So the answers live here, one seat each, and the sessions read them. When V1
// rewrites the ground and V2 rewrites the stair, THIS is the file that follows
// them, and nothing else has to.
//
// THEY ARE IMPLEMENTED TODAY, not sketched. Three of the six are the arithmetic
// that was already in the world, moved: the height of the meadow, the height of
// the worked stone, and what is under the feet by name. Two are honest noughts
// with the session that fills them written down. Reading a nought from a seat
// that exists is what lets V3 and V4 be written at all before V1 lands.
//
// AND A CONTRACT IS NOT A CONVENIENCE WRAPPER. Nothing here may quietly become
// a different answer from the one the frame draws: a camera behind a body that
// sank into a stair the walker was standing on is two opinions about one floor,
// and the picture would be the one that was wrong.

// ------------------------------------------------------------ the ground
//
// The field is arithmetic and could be evaluated directly, but it is sampled
// into a grid once and read back bilinearly instead: the walker asks for this
// every frame, and a grid read costs the same whatever the field grows into
// later.
//
// Built on FIRST ASK and not at import, because it is tens of milliseconds of
// arithmetic and the module graph is walked before there is a scene to spend
// them on. It is one grid for the whole run, which is the point: the walker's
// floor, the mesh's own vertices and anything V8 stands behind the walker all
// come off the same numbers.
let grid = null;

function sampled() {
  if (grid) return grid;
  const { samples, originX, originZ, spacing } = FIELD;
  const plane = new Float32Array(samples * samples);
  for (let j = 0; j < samples; j++) {
    const z = originZ + j * spacing;
    for (let i = 0; i < samples; i++) {
      plane[j * samples + i] = heightAt(originX + i * spacing, z);
    }
  }
  grid = plane;
  return grid;
}

/**
 * Height of the ground under a point, in metres.
 *
 * V1 FILLS THIS. Today it reads the bent grid of the meadow; tomorrow it is the
 * top of a column of the voxel disc inside r=35 and of the quantised shell
 * beyond it, and it still has to be one answer -- the walker cannot stand at a
 * height the ground is not drawn at.
 */
export function groundHeightAt(x, z) {
  const plane = sampled();
  const { samples, originX, originZ, spacing } = FIELD;
  const fx = (x - originX) / spacing;
  const fz = (z - originZ) / spacing;
  // Outside the grid the field is flat, so the rim value is the right answer.
  const i = Math.max(0, Math.min(samples - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(samples - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - i));
  const tz = Math.max(0, Math.min(1, fz - j));
  const a = plane[j * samples + i];
  const b = plane[j * samples + i + 1];
  const c = plane[(j + 1) * samples + i];
  const d = plane[(j + 1) * samples + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

// ----------------------------------------------------------- the basin
//
// HOW FAR THE GROUND HAS FALLEN, r METRES FROM THE MIDDLE OF THE WORLD.
//
// WHY THERE IS ONE AT ALL. The two targets put standing water seven degrees
// below the eye and the feet of three rings of ridge with it, and no plane at
// height nought can be read that way from either pose: for the water to be
// where it is drawn, the ground beyond the walkable disc has to DESCEND, by
// 4.6 m at sixty metres, 9.6 at a hundred, 15.8 at a hundred and fifty and 29.4
// at two hundred and sixty. That is a fact about the shape of the world and not
// about anybody's material, which is why it is a contract: V1 models the shell
// from 35 to 100 m against it and V5 carries it out past that, and if the two
// answered it separately the seam between them would be six degrees of ground.
//
// IT IS A CONE, AND THAT IS A READING AND NOT A CHOICE OF CURVE. Fitted with a
// straight line, the four measured depths come back within two and a half
// centimetres over twenty-nine metres of drop, and dropping the innermost of
// them moves the slope by two ten-thousandths. So the far basin is a plane
// falling at 0.1239 m per metre -- just over seven degrees -- and no smooth
// curve is needed to carry it.
//
// WHAT IS NOT MEASURED IS THE SHOULDER, AND IT IS SAID HERE RATHER THAN HIDDEN
// IN AN INTERPOLATION. That cone, run back inwards, crosses zero at r = 22.7 --
// INSIDE the walkable disc -- so it already stands a metre and a half below the
// rim at r = 35 and cannot both pass through the measurements and meet the disc
// at its own level. Something has to roll over between the two, the targets say
// nothing about its shape, and the only honest answer is the tamest curve that
// leaves the disc flat and joins the cone at the first place anybody measured:
// a Hermite from (35, nought, level) to (60, the cone, the cone's slope). It
// stays monotone -- checked, not assumed -- and its steepest point is 25%, at
// r = 49.6, which makes the rim of the basin twice as steep as its flank. If
// that reads wrong in a picture, it is this stretch that is wrong and not the
// cone, and it is twenty-five metres of ground wide.
//
// AND IT DOES NOT REACH heightAt. This is stated here rather than in
// terrain-field.js on purpose: that file IS the walkable floor, and the basin
// is the one shape in this world that must never be added to it -- a walker who
// found it would walk off the edge of the disc into a slope. contracts.js reads
// terrain-field and not the other way round, so from here it cannot.

/** Where the walkable disc ends and the shell begins, in metres. */
const BASIN_SHELL_R = 35;
/** The innermost radius anybody measured, and where the shoulder lets go. */
const BASIN_JOIN_R = 60;
/** Metres of fall per metre of radius, fitted on all four measured depths. */
const BASIN_SLOPE = 0.123938;
/** Where that fitted cone would reach height nought, in metres. */
const BASIN_APEX_R = 22.682;

/**
 * How far the ground beyond the disc has fallen, in metres, always <= 0.
 *
 * Nought inside the shell's inner edge, and nought there with a level tangent,
 * so whatever the disc does at its rim this welds onto it without a crease.
 *
 * PAST 260 m THIS IS AN EXTRAPOLATION and the owner of that ground should know
 * it: nothing was measured further out, and a straight cone carried to 420 m
 * says -49 m. It is left straight because a floor put under it here would be a
 * number nobody measured, dressed as one that was.
 *
 * @param {number} r  metres from the middle of the world
 * @returns {number} metres of fall, nought or negative
 */
export function basinProfile(r) {
  if (r <= BASIN_SHELL_R) return 0;
  const cone = -BASIN_SLOPE * (r - BASIN_APEX_R);
  if (r >= BASIN_JOIN_R) return cone;
  // Hermite with a level start: the two ends are the disc's rim and the cone,
  // and both the height and the slope are continuous at each of them.
  const span = BASIN_JOIN_R - BASIN_SHELL_R;
  const t = (r - BASIN_SHELL_R) / span;
  const end = -BASIN_SLOPE * (BASIN_JOIN_R - BASIN_APEX_R);
  return end * (3 * t * t - 2 * t * t * t) - BASIN_SLOPE * span * (t * t * t - t * t);
}

// ------------------------------------------------------- the worked stone

const DEG = Math.PI / 180;
const PLATFORM_SIN = Math.sin(PLATFORM.rotationY * DEG);
const PLATFORM_COS = Math.cos(PLATFORM.rotationY * DEG);

/**
 * Height of the built stone under a point, or -Infinity where there is none.
 *
 * V2 FILLS THIS. The stair and the platform are the only places the walker
 * leaves the meadow, and today they are flat topped boxes: their height is an
 * arithmetic answer, not something that needs a sampled grid the way the ground
 * does. When the stair becomes courses of blocks the arithmetic changes and this
 * is where it changes.
 */
export function builtHeightAt(x, z) {
  const dx = x - PLATFORM.x;
  const dz = z - PLATFORM.z;
  // Back into the platform's own frame, which is the inverse of the rotation
  // applied in stairs.js.
  const lx = dx * PLATFORM_COS - dz * PLATFORM_SIN;
  const lz = dx * PLATFORM_SIN + dz * PLATFORM_COS;
  if (Math.abs(lx) <= PLATFORM.width / 2 && Math.abs(lz) <= PLATFORM.depth / 2) {
    return PLATFORM.height;
  }
  return stairRunHeight(x, z);
}

/**
 * Height of the STAIR RUN alone, or -Infinity off it.
 *
 * THE SIXTH NAME, AND IT IS NOT A DUPLICATE OF THE ONE ABOVE. The gait needs
 * the run and not the union: the platform is flat and the run is a ramp, and
 * the ease that keeps the eye riding the nosings has to know which it is
 * standing on. The two footprints very nearly touch -- the platform reaches
 * about z = -14.29 and the run starts at -14.30 -- so answering this with
 * "built stone, and not the platform" would have differed from the world on a
 * sliver a centimetre wide, which is exactly the kind of thing that turns up as
 * a hitch in the walk six weeks later.
 *
 * It is here so that src/core/presence.js does not import src/world/stairs.js,
 * which is V2's file. Same arithmetic, one door.
 */
export const stairHeightAt = stairRunHeight;

// -------------------------------------------------------- what is underfoot

/**
 * What is under the feet, by name: piattaforma, scalinata, sentiero or erba.
 *
 * Nothing here is new information: the platform is a rotated box in the layout,
 * the stair run answers for itself, and the path is the same signed distance
 * from the same fitted centreline that paints the albedo and cuts the relief --
 * so the sound and the picture can never disagree about where the stone stops.
 *
 * V1, V2 AND V3 ALL REACH THIS. In a voxel world the category is the material of
 * the column, which is a cleaner answer than this one and not a different one.
 */
export function materialAt(x, z) {
  const dx = x - PLATFORM.x;
  const dz = z - PLATFORM.z;
  if (Math.abs(dx * PLATFORM_COS - dz * PLATFORM_SIN) <= PLATFORM.width / 2
    && Math.abs(dx * PLATFORM_SIN + dz * PLATFORM_COS) <= PLATFORM.depth / 2) return 'piattaforma';
  if (stairRunHeight(x, z) !== -Infinity) return 'scalinata';
  if (pathRun(z) > 0.5 && Math.abs(pathCoord(x, z)) <= 1) return 'sentiero';
  return 'erba';
}

// ------------------------------------------------------------- the two noughts

/**
 * Whether the ground is cut away here, because something else owns this column.
 *
 * V3 FILLS THIS, and it is FALSE EVERYWHERE TODAY -- which is the truth and not
 * a placeholder. The path in this world is not separate geometry: it is painted
 * into the ground's albedo and cut into the height field, so there is no hole
 * anywhere and saying otherwise would be a lie the walker could fall through.
 *
 * When the corridor becomes geometry of its own, V3 turns this on over its own
 * footprint and V1's disc stops laying columns where it answers true. That is
 * the whole of the agreement between those two sessions, and it is one function
 * rather than a conversation.
 */
export function groundHoleAt() {
  return false;
}

/**
 * The two terms of the ground's own light at a point, or null where nobody can
 * yet say.
 *
 * V1 FILLS THIS AND V4 EATS IT. A card of grass has to be lit by the ground it
 * stands on, or the meadow separates into blades of one brightness standing in
 * grass of another -- which is measured, not feared: with the cards lit off a
 * bake while the cubes beside them were lit analytically, the cards were the
 * brightest population in the frame.
 *
 * IT IS NULL TODAY AND THAT IS HONEST. The bridge exists, but it is in the
 * vertex shader: src/world/vegetation.js reads the delivered ground atlas at the
 * foot of every card, through the same unpacking every other baked surface uses.
 * There is no CPU-side answer to hand back, because there is no CPU-side copy of
 * that atlas -- and inventing one would be a second opinion about the light.
 * What this seat buys today is the DECLARATION: the coupling is written down,
 * with both owners on it, instead of being discovered when the atlas goes away.
 */
export function groundLightAt() {
  return null;
}

// ------------------------------------------------------- the lamps and the field

/**
 * Where the flowers of the meadow stand, for whatever wants to hang a light on
 * one.
 *
 * V4 FILLS THIS AND V7 EATS IT, and the direction of that arrow is the whole
 * contract. The night target lights its meadow with small warm points, and the
 * only place they can honestly stand is where the flowers already are — a lamp
 * floating over bare grass reads as a lamp, and a lamp in a flower reads as the
 * flower. So V7 does not choose those positions and does not scatter a field of
 * its own beside V4's: it asks for the one that is already drawn.
 *
 * AND V4 KNOWS NOTHING ABOUT THE NIGHT. It publishes where its flowers are,
 * which is a fact about the meadow. If the coupling ran the other way — the
 * lamps telling the meadow where to put flowers — the day would be arranged by
 * a session that only ever looks at the night target, and the two pictures the
 * campaign is judged on would be fitted against each other.
 *
 * IT IS EMPTY TODAY AND THAT IS THE TRUTH. There is no flower field yet, so
 * there is nowhere for a lamp to stand, and an invented point would be a lamp
 * placed by the foundation. What this seat buys now is that V7 can be written
 * against a name instead of against V4's internals, and that the day the field
 * lands the night gets it without either session opening the other's file.
 *
 * THE SIGNATURE CARRIES FIVE FIELDS. This seat documented {x, z, y} and the
 * ratified contract said {x, z, size}, which was one contract written down
 * twice: the night needs the head of the flower to hang the lamp at AND how big
 * the flower is to size the core and the halo against. `kind` is the fifth,
 * and it is what lets the selection below be made on a fact about the meadow
 * rather than on an index.
 *
 * AND THE SELECTION IS V7'S, NOT V4'S — WHICH IS THE WHOLE REASON THE LIST IS
 * LONGER THAN THE ANSWER. V4 publishes EVERY flower it drew: that is a fact
 * about the day, it is the same list at every hour, and a session that filtered
 * it would be deciding the night inside the file that owns the meadow. V7 then
 * lights a SUBSET, under a cap and a radius of its own. The gap is not small
 * and nobody should discover it at integration: the night target burns 150 to
 * 250 points where a meadow of this density offers on the order of 8500, so
 * roughly one flower in forty is lit, and the ones that are lit are near and
 * clustered rather than sampled evenly. Which forty is the night's taste and
 * the night's budget, and it is stated here so that neither session mistakes
 * the length of this array for the number of lamps.
 *
 * @returns {{x: number, y: number, z: number, size: number, kind: string}[]} in
 *          world metres, y at the head of the flower rather than at the ground
 *          under it, size the width of the flower a lamp is being hung in, kind
 *          which flower it is — the handle V7 selects on
 */
export function flowerLightPoints() {
  return [];
}
