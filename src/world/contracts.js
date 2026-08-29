import { heightAt, pathCoord, pathRun } from './terrain-field.js';
import { stairHeightAt as stairRunHeight } from './stairs.js';
import { flowerField } from './vegetation.js';
import { PLATFORM } from './layout.js';
import { pathHoleAt } from './path.js';
import { CENTRE, DISC_RADIUS, VOXEL, columnTop } from './voxel/mesher.js';

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
// THE GROUND IS THE CARPET NOW, AND THIS SEAT HAD NOT NOTICED. Until this unit
// the answer here was the smooth field, sampled into a grid every 0.28 m and
// read back bilinearly -- which was the whole truth while the meadow was a bent
// grid laid ON that field. It stopped being the truth the day the disc became
// the world: measured over the disc it lays, the tops of the cubes stand a
// MEDIAN 12.5 cm and as much as 1.20 m above the field, so a walker seated on
// the field walks through ground he can see (v1-suolo/analisi/d4-cuciture.json).
// The picture is not wrong; this was.
//
// IT IS THE CARPET'S FIELD AND NOT THE CARPET'S MESH, and that is the whole of
// why it can be here at all. `columnTop` is a pure function of a point: it is
// what the worker meshes FROM, so it answers before a single chunk has been
// cut, off the main thread, on a page whose disc is still being built, and in a
// node harness with no page at all. Reading the delivered height maps instead
// -- ground-voxel's own topAt -- would have made the walker's floor depend on
// whether a download had finished, which is the one thing a contract may never
// do.
//
// AND IT COSTS WHAT IT COSTS, MEASURED RATHER THAN FEARED: 1 165 ns a call
// against the grid's 46, which is 7.0 microseconds a frame at the six calls a
// step takes, against sixteen thousand (v1-suolo/analisi/d4-costo.json). The
// grid was justified in this file by the walker asking every frame; the walker
// is not what makes this expensive and never was.

// How far the ten centimetre ground reaches, in metres.
//
// THE TIER DECIDES IT AND THE GROUND DECLARES IT, because the disc that ships
// is not the engine's own: quality.js carries 14 m on three tiers and 12 on the
// fourth, and a contract that answered for 35 would be promising cubes over
// twenty metres of ground the page draws as sheet. The engine's default sits
// here only so that the honest answer to "nobody has said yet" is the engine's
// and not a number invented in this file.
let discRadius = DISC_RADIUS;

/**
 * What the ground session laid, told to the seat that has to answer for it.
 *
 * Called by src/world/layers/v1-suolo.js at the one place the radius is
 * resolved, so the disc, the sheet and this contract are three readers of ONE
 * decision rather than three opinions about it.
 *
 * @param {number} radius  metres of ten centimetre ground from the centre
 */
export function setGroundDiscRadius(radius) {
  discRadius = radius > 0 ? radius : DISC_RADIUS;
  return discRadius;
}

// What columnTop hands back where no column stands. The engine keeps the value
// to itself, so it is recognised by size and not by equality: no top of any
// real column is within a decade of it, and matching on the magnitude cannot
// break the day the engine picks a different sentinel.
const NO_TOP = -1e8;

/**
 * Height of the ground under a point, in metres.
 *
 * V1 FILLS THIS, and it is three grounds behind one name because the world has
 * three and the walker may stand on all of them:
 *
 *   1. WHERE THE CORRIDOR OWNS THE GROUND the answer is the field, and it is
 *      the field EXACTLY rather than resampled. groundHoleAt is true over
 *      precisely the footprint V3's surface covers, that surface is laid on the
 *      ground rather than on a column, and a cube answered here would put the
 *      walker on a lip the paving is drawn over. Measured on the corridor, the
 *      exact field stands 26.4 mm from the ground as drawn at worst against the
 *      grid's 28.8 -- the rest of that gap is the meadow's own triangulation
 *      and belongs to whoever chose it, which is said in full in the verbale.
 *   2. INSIDE THE DISC the top of the column, which is what the frame draws.
 *      Where the disc lays none -- a block's own footprint -- the bent grid is
 *      still what draws, so the field answers there too.
 *   3. BEYOND THE DISC the sheet, SNAPPED THE WAY THE SHEET SNAPS. This is not
 *      a flourish: the walker's hard radius is 21 m and the disc reaches 14, so
 *      seven metres of what he can walk on are sheet, and an unsnapped answer
 *      there would have him riding a smooth field over terraced ground for a
 *      third of his own range.
 *
 * The arithmetic of 3 is ground-shell.js's shellHeight, RE-DECLARED and not
 * imported, and that is a debt this unit is naming rather than hiding: the
 * sheet is built in a session file and the contract cannot import a layer
 * without the layer's whole dependency graph following it into every tool that
 * reads a height. The two are pinned together by guard-lift's own leg rather
 * than by an import -- see the note there.
 */
export function groundHeightAt(x, z) {
  // 1. Something else owns this column, and it is laid on the ground rather
  //    than on the carpet.
  if (groundHoleAt(x, z)) return heightAt(x, z);
  // 2. The carpet, from the arithmetic the worker meshes from.
  const top = columnTop(Math.floor(x / VOXEL), Math.floor(z / VOXEL), true, discRadius);
  if (top > NO_TOP) return (top + 1) * VOXEL;
  const r = Math.hypot(x - CENTRE.x, z - CENTRE.z);
  //    Inside the disc with no column: a block's footprint, where the grid draws.
  if (r <= discRadius) return heightAt(x, z);
  // 3. The sheet.
  return Math.round((heightAt(x, z) + basinProfile(r)) / VOXEL) * VOXEL;
}

// ----------------------------------------------------------- the basin
//
// HOW FAR THE GROUND HAS FALLEN, r METRES FROM THE MIDDLE OF THE WORLD.
//
// WHY THERE IS ONE AT ALL. The two targets put standing water about three
// degrees below the eye and the feet of three rings of ridge with it, and no
// plane at height nought can be read that way from either pose: for the water
// to be where it is drawn, the ground beyond the walkable disc has to DESCEND.
// That is a fact about the shape of the world and not about anybody's
// material, which is why it is a contract: V1 models the shell from 35 to
// 100 m against it and V5 carries it out past that, and if the two answered
// it separately the seam between them would be degrees of ground.
//
// IT IS A CONE, AND THAT IS A READING AND NOT A CHOICE OF CURVE -- READ TWICE.
// The first fit (0.1239 m per metre) was taken through the camera the campaign
// has since refit away from: at the poses the register carries today the two
// arms of standing water sit at -2.92 and -3.66 degrees, and the old cone put
// them at -8.00 -- eighty-seven pixels of world too low. Re-read against the
// true radii of both arms (110.4 and 108.9 m), the left asks 0.0462 and the
// right 0.0624, AND NO SINGLE CONE SATISFIES BOTH: the 0.74 degrees between
// them is the floor of the model, not a defect of any session. The slope
// carried here is the minimax between the two in pixels, with the apex held
// where the first fit put it, and it leaves a BALANCED RESIDUAL OF +/-6.8 px
// PER ARM. That residual is part of this contract: a gate that reads the water
// a few pixels from either target is reading the model, not a mistake.
//
// WHAT IS NOT MEASURED IS THE SHOULDER, AND IT IS SAID HERE RATHER THAN HIDDEN
// IN AN INTERPOLATION. The cone, run back inwards, crosses zero at r = 22.7 --
// INSIDE the walkable disc -- so it cannot both pass through the readings and
// meet the disc at its own level. Something has to roll over between the two,
// the targets say nothing about its shape, and the only honest answer is the
// tamest curve that leaves the disc flat and joins the cone at the first place
// anybody measured: a Hermite from (35, nought, level) to (60, the cone, the
// cone's slope). It stays monotone -- the form is unchanged by the refit and
// scales linearly in the slope -- and its steepest point is now 10.9%, at
// r = 49.6. If that stretch reads wrong in a picture, it is this stretch that
// is wrong and not the cone, and it is twenty-five metres of ground wide.
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
/**
 * Metres of fall per metre of radius: the minimax between the two arms of
 * water read at the register's poses (0.0462 left, 0.0624 right), residual
 * +/-6.8 px per arm declared above as the model's own floor.
 */
const BASIN_SLOPE = 0.0543;
/** Where the first fit's cone reached height nought; held through the refit. */
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
 * V3 fills this: the corridor is the meadow's one hole, and V1's disc stops
 * laying columns where it answers true. That is the whole of the agreement
 * between those two sessions, and it is one function rather than a
 * conversation. See src/world/path.js.
 */
export function groundHoleAt(x, z) {
  return pathHoleAt(x, z);
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
 * AND THE FIELD HAS LANDED. What this seat used to buy was that V7 could be
 * written against a name while V4 built the meadow behind it; what it returns
 * now is the meadow V4 draws, out of the one function that decides a flower --
 * src/world/vegetation.js, the same call with the same lattice and the same
 * seed the ring of drawn flowers is filled from. A second sowing here, however
 * carefully matched, would be a lamp standing where no flower is.
 *
 * IT IS THE WHOLE DISC AND NOT THE RING. The ring V4 draws is a few hundred
 * heads within a few metres of the walker, because triangles; this is every
 * flower inside r = 35 m, because a lamp is not a triangle and the night gets
 * to choose. The height under each one comes from groundHeightAt above, which
 * is the same function the hub hands the layer that draws them, so what is
 * published and what is drawn stand at one height by construction rather than
 * by agreement.
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
 * 250 points where a meadow of this density offers on the order of ten
 * thousand, so roughly one flower in fifty is lit, and the ones that are lit
 * are near and clustered rather than sampled evenly. Which fifty is the night's
 * taste and the night's budget, and it is stated here so that neither session
 * mistakes the length of this array for the number of lamps.
 *
 * ONE NUMBER IN HERE HAS MOVED SINCE V7 WAS BRIEFED, AND IT IS `size`. The
 * signature has not: it is the five fields E-V4c ratified. But the census that
 * put a head at 0.13 to 0.15 m ran the target through the camera in
 * assets-src/materia/ricetta.json, and E-V8f refitted the poses under a 1.80 m
 * walker — the eye dropped 1.15 m and the focal length went from 979 to 1159
 * px. Re-derived at the poses as they stand, a head is 0.082 m and a cyan one
 * 0.073, so what this returns is smaller than the briefing said by two fifths.
 * That is not a loss: E-V7e measured the night lamp's own core at 0.103 m — one
 * voxel — against a day flower the old census called half again bigger, and a
 * lamp cannot be smaller than the flower it is hung in. At 0.082 the two
 * sessions are measuring the same object again.
 *
 * @returns {{x: number, y: number, z: number, size: number, kind: string}[]} in
 *          world metres, y at the head of the flower rather than at the ground
 *          under it, size the width of the flower a lamp is being hung in, kind
 *          which flower it is — the handle V7 selects on
 */
export function flowerLightPoints() {
  if (!flowers) flowers = flowerField(groundHeightAt);
  return flowers;
}

// The seats a lamp could take along the distant ridges arrive with the
// cornice session: V5 wires `ridgeLampSeats` here on its own branch, the way
// the path wired the ground's one hole, and it reaches this file at
// integration. Until then the name is only a promise written down.

// Built on FIRST ASK and kept, for the reason the ground's grid above is: it is
// tens of thousands of lattice draws over the whole disc, the answer does not
// change, and the night may ask for it more than once.
let flowers = null;
