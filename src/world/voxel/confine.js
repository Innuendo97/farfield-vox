// THE EDGE OF THE WORLD, AS GROUND AND NOT AS A FENCE.
//
// ===========================================================================
// WHOSE DECISION THIS FILE CARRIES OUT, IN HIS OWN WORDS.
//
// E-DECISIONI13: «L'AREA GIOCABILE E' IL DISCO su un ALTOPIANO; oltre, il
// terreno scende a GRADONI VOXEL verso il lago tutt'intorno (la conca di
// basinProfile), con le CRESTE TERRAZZATE a chiudere l'orizzonte ai lati e
// dietro lo spawn; il camminatore si ferma dove comincia l'ACQUA e dove le
// terrazze superano il passo (0,30 m): NESSUNA staccionata; NESSUNA sfocatura
// (la foschia dell'aria fittata fa il lavoro)».
//
// So the boundary of this world is not drawn, it is WALKED INTO: the ground
// keeps going, it falls away in steps a body can take until it cannot, and what
// stops the walker is water on one side and a riser too tall on the others.
// There is no ring, no wall, no blur and no circle anybody can see.
//
// ===========================================================================
// WHAT IS DECIDED HERE AND WHAT IS NOT.
//
// The SHAPE of the crests is V5's -- it owns the frame of the world and the
// register the far ridges were read off. What is decided here is the BASE the
// exact shape will be written against, and it is deliberately the simplest
// thing that answers the decision: a plateau, a fall quantised into terraces,
// and one ridge that closes the horizon without a straight line on it. Every
// number below is a dial in ONE object, so V5 moves the ridge by editing a
// literal rather than by rewriting a law.
//
// ===========================================================================
// THE FALL IS NOT THIS FILE'S INVENTION, WHICH IS THE POINT OF READING IT.
//
// How far the ground beyond the disc has dropped is a CONTRACT -- basinProfile,
// fitted against the two arms of standing water in the reference and shared
// with V5, who carries it past a hundred metres. The committente named it by
// name. It moved INTO this file from src/world/contracts.js, unchanged and
// still exported from there, for one reason: the boundary of the world is now
// one law with two terms, and a contract carrying one of the two -- the term
// that is quantised into terraces somewhere else -- would be half a boundary.
// So this file does not model a fall: it carries the fitted one and QUANTISES
// it, which is the whole of what «gradoni voxel» adds.
//
// The quantisation is not a decoration either. A cone of 0.0543 metres per
// metre, cut into steps of one voxel, puts a riser every 1.84 m of radius: the
// treads are wide, the risers are one cube, and the walker can take every one
// of them (0.10 m against a step of 0.30). That is what makes the fall a place
// somebody can go instead of a slope they slide off.
//
// ===========================================================================
// THE CREST, AND WHY ITS RISER IS FOUR VOXELS AND NOT ONE.
//
// A ridge that climbs twelve metres over forty is a slope of 0.3, and one voxel
// of quantisation on that slope puts a riser every 33 cm -- which at ninety
// metres is a fifth of a pixel and reads as a smooth green hill, not as the
// terraced stone the target shows. So the crest carries a riser of its own,
// four voxels, which puts its treads at about 1.3 m: terraces the eye can count
// at the distance they are seen from, and risers a body cannot climb, which is
// the second half of E-DECISIONI13's own limit on the walker.
//
// Both quantisations are whole numbers of voxels, so the sum is one: nothing in
// this world stands at a height that is not a multiple of the cube.

import { VOXEL } from './columns.js';

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
// AND IT DOES NOT REACH THE WALKABLE FLOOR. This is stated here rather than in
// the generator on purpose: the base of the disc is the walkable floor, and the
// basin is the one shape in this world that must never be added to it -- a
// walker who found it would walk off the edge of the disc into a slope. It is
// added to the floor the disc DRAWS and only past thirty five metres. THAT LAST
// SENTENCE IS THE ONE E-DECISIONI13 AMENDED: past thirty five metres somebody
// DOES stand now, and what they stand on is this fall cut into steps they can
// take -- see confineSteps below. The rule the sentence was protecting is
// intact and is why the quantisation lives here and not in the fit: the
// walkable floor of the plateau is still nought, and the basin still never
// touches it.

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

/** Degrees to radians, once. */
const DEG = Math.PI / 180;

/**
 * Every dial of the edge of the world, in one object, so that V5 can move the
 * ridge without reading a line of the arithmetic under it.
 *
 * WHAT EACH ONE IS FOR, and none of them is fitted against a picture: this is
 * the BASE, and the register the exact ridge will be fitted to is V5's.
 */
export const CONFINE = {
  /**
   * Where the plateau stops being level, in metres from the middle of the
   * world.
   *
   * THIRTY FIVE, AND IT IS NOT A NUMBER OF THIS FILE'S. It is DISC_RADIUS --
   * the radius the campaign has called the playable ground since the first
   * step, the one §2.9's allocation is written at, the one basinProfile's own
   * shoulder is anchored to, and the one the committente named. Repeating it
   * here as a literal would be a second opinion about the size of the world, so
   * it is read from the seat that states it (see PLATEAU below).
   */
  plateau: 35,

  /**
   * The riser of a terrace on the FALL, in voxels.
   *
   * One, because the fall has to be walkable: a cube is 0.10 m and the step a
   * body may take is 0.30.
   */
  riser: 1,

  /**
   * WHERE THE STANDING WATER LIES, as the radius of the basin its surface is
   * level with -- in metres, and NOT as a height.
   *
   * E-DECISIONI19, on the bivio E-PERF3 left open: «LAGO: abbassare l'acqua
   * alla conca (distant.js +0,30 -> quota della conca a 110 m, -4,74)».
   *
   * A RADIUS AND NOT A HEIGHT, WHICH IS THE WHOLE POINT OF THE DIAL. The water
   * was a literal in src/world/distant.js -- +0.30 m, read off the framing by
   * V5 at a time when the ground beyond the disc was a SHEET and there was no
   * fall for a lake to lie in. The day E-DECISIONI13 gave the world a basin,
   * that literal became a lake floating four and a half metres over its own
   * bed, and it went on floating because nothing tied the two numbers together.
   * Written as a radius the tie cannot come undone: the surface IS basinProfile
   * at this distance, so a refit of the basin carries the water with it and can
   * never leave it hanging again.
   *
   * ONE HUNDRED AND TEN, WHICH IS WHERE THE WATER WAS READ. basinProfile is
   * fitted THROUGH the two arms of standing water the reference shows, at 110.4
   * and 108.9 m (see the fit above); the committente named the round number
   * between them and it is the one carried here. The two sheets take ONE level
   * between them and not one each: a basin holds one lake, and two sheets each
   * at its own radius would stand 7.6 cm apart with a step in the water.
   */
  waterAt: 110,

  /** The ridge that closes the horizon. */
  crest: {
    /** Where the ground stops falling and starts climbing, in metres. */
    foot: 58,
    /** Where the ridge is highest. */
    peak: 96,
    /** Where it has come back down to the basin behind itself. */
    back: 168,
    /**
     * How high the crown of the ridge stands OVER THE PLATEAU, in metres --
     * over the walkable floor of the world and not over the basin it grows out
     * of, because that is the height a person can picture.
     *
     * ELEVEN, AND IT IS THE ONE NUMBER HERE A PICTURE WAS CONSULTED ABOUT --
     * read off the day target rather than fitted to it. The left ridge crowns
     * about nine degrees over the horizon at the framing pose; at the radius
     * this file puts the peak that is a dozen metres, and the waves below carry
     * the tallest bearing to fourteen.
     *
     * AND THERE IS A CEILING OVER IT THAT IS NOT A TASTE: the picture holds a
     * ground in ONE byte of voxels biased by CAMPO_BIAS, which reaches 15.5 m
     * over the plateau. The crown plus its sway has to stay under that or it
     * goes FLAT and nothing looks broken. guard-confine sweeps the law and
     * asserts it, so raising this is a change somebody is told about.
     */
    height: 11,
    /**
     * The riser of a terrace on the RIDGE, in voxels.
     *
     * FOUR, so the treads read as terraces at the distance the ridge is seen
     * from -- and so a body cannot climb one, which is the limit
     * E-DECISIONI13 puts on where the walker may go.
     */
    riser: 4,
    /**
     * The bearing gate: how much of the ridge stands at a given bearing from
     * north, which is where the lake is and where the framing looks.
     *
     * «le creste terrazzate a chiudere l'orizzonte AI LATI E DIETRO LO SPAWN»:
     * so the ridge is nought straight ahead, where the water and the far hills
     * are what the reference shows, and whole to the sides and behind. The two
     * angles are where it starts and finishes coming up.
     */
    gateFrom: 20,
    gateTo: 54,
    /**
     * What is left of the ridge INSIDE the gate.
     *
     * NOUGHT, AND THAT IS THE WALKER'S OWN LIMIT AND NOT A LOOK. The ridge is
     * quantised in four-voxel risers so that its terraces read at ninety metres
     * -- and a riser of forty centimetres is one a body cannot take. Toward the
     * water the body MUST be able to walk down to the shore (E-DECISIONI13: «il
     * camminatore si ferma dove comincia l'ACQUA»), so any fraction of the
     * ridge left standing there would put a wall in front of the lake wearing
     * the ridge's own step. Measured, a gate of a twentieth was enough to do
     * it: 0.40 m risers on the bearings the water is on.
     */
    gateMin: 0,
    /**
     * THE THREE TURNS THAT KEEP IT FROM BEING A CIRCLE.
     *
     * «NESSUNA circonferenza visibile» is the whole point of the boundary, and
     * a ridge of one radius and one height is a circumference whatever it is
     * made of. So the height and the reach of the crest are both moved by three
     * waves of the bearing whose periods share no factor -- three, seven and
     * thirteen turns of the compass -- which is the same device the far hills
     * of src/world/distant.js already use and for the same reason.
     */
    waves: [
      { turns: 3, phase: 0.31, weight: 1.00 },
      { turns: 7, phase: 1.94, weight: 0.44 },
      { turns: 13, phase: 4.10, weight: 0.23 },
    ],
    /** How much of the height the waves may move, as a fraction. */
    sway: 0.28,
    /** How much of the radius the waves may move, as a fraction. */
    reach: 0.11,
  },
};

/**
 * The plateau's radius, read from the engine's own statement of it.
 *
 * It is imported rather than written because DISC_RADIUS is the campaign's word
 * for the same distance, and two literals is how the two would part company.
 * The import goes the other way round -- ./worldgen.js reads this file -- so the
 * number arrives here through CONFINE and is asserted against the engine's by
 * the guard rather than by a circular import.
 */
export const PLATEAU = CONFINE.plateau;

/**
 * THE HEIGHT OF THE STANDING WATER, in metres over the plateau's own floor.
 *
 * The one number src/world/distant.js is allowed to lay its two sheets at, and
 * the reason it is a FUNCTION and not a constant anybody could copy: a lake is
 * a level in a basin, so the only honest way to write it is to ask the basin.
 *
 * IT IS DELIBERATELY NOT QUANTISED, and the guard asserts that it is not. The
 * fall is cut into terraces of one voxel; a surface put ON a tread would share
 * a plane with it over a whole annulus of ground and the two would fight for
 * every pixel of it. Left where the fitted cone actually passes, it falls
 * INSIDE a riser -- 4.1 cm under the last dry tread and 5.9 cm over the first
 * drowned one, as it stands -- so the water laps against the face of a step,
 * which is what a shore is. Nothing is cantilevered over it and nothing gapes
 * under it, because the ground it meets is continuous and this is a level
 * through it, not a second surface fitted beside it.
 *
 * AND THE SHORE IS NO LONGER DRAWN, IT IS FOUND. Where the water's edge appears
 * used to be the near edge of a rectangle V5 read off the framing; it is now
 * wherever the terraces come up through this level, decided by the depth buffer
 * from two pieces of arithmetic that both answer basinProfile. On the open
 * bearings that is 110.16 m, and it moves with the ridge where the ridge wades
 * in, which no rectangle could have done.
 *
 * @returns {number} metres, negative: the basin's own depth at CONFINE.waterAt
 */
export function waterLevel() {
  return basinProfile(CONFINE.waterAt);
}

/**
 * The sum of the three waves at one bearing, in [-1, 1].
 *
 * @param {number} bearing  radians, nought is north
 */
function sway(bearing) {
  const { waves } = CONFINE.crest;
  let sum = 0;
  let weight = 0;
  for (const w of waves) {
    sum += w.weight * Math.sin(bearing * w.turns + w.phase);
    weight += w.weight;
  }
  return sum / weight;
}

/**
 * How much of the ridge stands at one bearing, in [gateMin, 1].
 *
 * @param {number} bearing  radians, nought is north
 */
function gate(bearing) {
  const { gateFrom, gateTo, gateMin } = CONFINE.crest;
  // Unsigned degrees from north: the gate is symmetric because the lake is
  // ahead and the ridge is everywhere else.
  let deg = Math.abs(bearing) / DEG % 360;
  if (deg > 180) deg = 360 - deg;
  const t = (deg - gateFrom) / (gateTo - gateFrom);
  const s = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  return gateMin + (1 - gateMin) * s;
}

/**
 * How high the ridge stands at one point, in metres over the plateau, before
 * the terraces are cut into it.
 *
 * ONE HUMP AND NOT A CURVE FITTED TO ANYTHING: it rises from the foot, crowns
 * at the peak and falls away behind, with both halves smooth so the ground has
 * no crease at either end. What makes it a landscape rather than a torus is
 * that BOTH the height and the radius of the crown ride the waves.
 *
 * @param {number} r  metres from the middle of the world
 * @param {number} bearing  radians, nought is north
 */
export function crestRise(r, bearing) {
  const c = CONFINE.crest;
  const s = sway(bearing);
  const g = gate(bearing);
  if (g <= 0) return 0;
  // The crown walks in and out with the bearing, and the two ends of the hump
  // walk with it, so the ridge is never the same distance away twice.
  const shift = 1 + c.reach * s;
  const foot = c.foot * shift;
  const peak = c.peak * shift;
  const back = c.back * shift;
  if (r <= foot || r >= back) return 0;
  const t = r < peak ? (r - foot) / (peak - foot) : (back - r) / (back - peak);
  const shape = t * t * (3 - 2 * t);
  // AND THE HEIGHT IS COUNTED FROM THE PLATEAU, WHICH IS WHY THE FALL APPEARS
  // IN A FUNCTION ABOUT THE RIDGE. The ridge grows out of the basin, so a crown
  // asked to stand eleven metres over the PLATEAU has to climb the four the
  // basin has already dropped by the time it gets there. Written the other way
  // round the dial would mean "eleven metres over whatever the fall happens to
  // be under me", which is not a height anybody can picture and which would
  // move every time the contract was refit.
  //
  // AND THE SWAY MOVES THE CROWN AND NOT THE CLIMB, for the same reason: the
  // tallest bearing of the ridge has to be a number a reader can check against
  // the byte's own ceiling, and `height * (1 + sway)` is that number.
  const crown = c.height * (1 + c.sway * s);
  return (crown - basinProfile(peak)) * g * shape;
}

/**
 * How far the ground stands over the plateau's own floor at one point, in
 * metres, BEFORE the terraces are cut -- the smooth shape the steps are cut
 * from.
 *
 * @param {number} x  metres, world
 * @param {number} z  metres, world
 * @param {object} centre  the middle of the world
 */
export function confineSurface(x, z, centre) {
  const dx = x - centre.x;
  const dz = z - centre.z;
  const r = Math.hypot(dx, dz);
  // Bearing from NORTH, which is -z: the whole campaign measures its framings
  // from there and the gate above is written in the same compass.
  const bearing = Math.atan2(dx, -dz);
  return { r, bearing, fall: basinProfile(r), rise: crestRise(r, bearing) };
}

/**
 * THE HEIGHT OF THE GROUND BEYOND THE PLATEAU, AS A WHOLE NUMBER OF VOXELS
 * OVER THE PLATEAU'S OWN TOP COLUMN.
 *
 * The two quantisations are separate and both are whole cubes, which is what
 * lets the fall be walkable and the ridge not be. Nothing else in the world is
 * allowed to round a height twice, so this is the only place either rounding
 * happens.
 *
 * @param {number} x  metres, world
 * @param {number} z  metres, world
 * @param {object} centre  the middle of the world
 * @returns {number} steps of a voxel, nought on the plateau, negative in the
 *                   basin, positive on the ridge
 */
export function confineSteps(x, z, centre) {
  const { fall, rise } = confineSurface(x, z, centre);
  const down = Math.round(fall / VOXEL / CONFINE.riser) * CONFINE.riser;
  const up = Math.round(rise / VOXEL / CONFINE.crest.riser) * CONFINE.crest.riser;
  return down + up;
}

/**
 * The steepest riser a body meets between two neighbouring columns out there,
 * in metres, over a ring of bearings: what a guard reads to say where the
 * walker is stopped by the ground rather than by a fence.
 *
 * @param {object} centre
 * @param {number} from  metres
 * @param {number} to    metres
 */
export function confineRisers(centre, from, to) {
  const rows = [];
  for (let deg = 0; deg < 360; deg += 1) {
    const a = deg * DEG;
    const ux = Math.sin(a);
    const uz = -Math.cos(a);
    let worst = 0;
    let worstAt = 0;
    for (let r = from; r < to; r += VOXEL) {
      const h0 = confineSteps(centre.x + ux * r, centre.z + uz * r, centre);
      const h1 = confineSteps(centre.x + ux * (r + VOXEL), centre.z + uz * (r + VOXEL), centre);
      const jump = Math.abs(h1 - h0) * VOXEL;
      if (jump > worst) { worst = jump; worstAt = r; }
    }
    rows.push({ deg, worst, worstAt });
  }
  return rows;
}
