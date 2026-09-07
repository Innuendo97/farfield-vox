import {
  BufferAttribute, BufferGeometry, CircleGeometry, Group, Mesh, ShaderMaterial, Vector3,
} from 'three';
import { SKY_GLSL, SKY_REFLECTION, SKY_REFLECTION_GLSL, SKY_UNIFORMS } from '../core/sky.js';
import * as AIR from './air.js';
import { FOG_GLSL, FOG_RADIANCE, fogUniforms } from './air.js';
import { waterLevel } from './voxel/confine.js';
import SPEC from '../../assets-src/distant/cornice.json' with { type: 'json' };
import { ladders, ridgeLampSeats } from '../../assets-src/distant/cornice.mjs';
import { buildHills, palette } from './distant-mesh.js';

// EVERYTHING PAST THE WATER: HILLS OF CUBES, AND ONE LAKE.
//
// ===========================================================================
// WHAT THIS FILE STOPPED BEING.
//
// It was three painted rings at 150, 260 and 420 metres, a floor under them
// from 100 to 760, rectangles of standing water, six giant slabs, and grey
// spires standing on the rings as a declared placeholder. Behind all of it, and
// in FRONT of most of it, src/world/voxel/confine.js put a smooth green ridge
// eleven metres high at ninety-six -- so what the walker actually saw was
// spires over a wall.
//
// R6 measured that against the reference and the verdict is its §0: the
// reference has no wall, no line and no city. It has HILLS -- three and four
// planes of them stacked behind one another, from 3.7 to 9.5 degrees at the
// sides -- and in the gap where the lake is it does not close at all: water to
// the far shore, then hills at two to seven. E-DECISIONI21 answered D7 with A:
// the crest at ninety-six metres and the giants FALL, and there are hills all
// the way round beyond the water.
//
// So there is ONE law now (assets-src/distant/cornice.mjs), fitted per
// direction against the traced skyline (assets-src/distant/cornice.json), built
// here into a static greedy mesh of real cubes that grow with their distance,
// and ONE disc of water at the level the boundary already states. The crest,
// the rectangles, the floor, the giants and the spires are gone.
//
// ===========================================================================
// WHY A HUNDRED AND FIFTY THOUSAND TRIANGLES COST LESS THAN FOUR THOUSAND DID.
//
// That is the surprising half, and both halves of it were measured.
//
//   1. THE FIELD PAID FOR THE WALL IN PIXELS. E-PERF5 established that the
//      meadow's cost is the number of PIXELS OF GROUND it marches and not the
//      arithmetic per pixel: the card here is bound by bandwidth, not by ALU.
//      The crest at ninety-six metres filled five to seven degrees of the frame
//      with marched ground on eighty-five bearings out of a hundred and eight.
//      Taking it away gives the rays of the horizon band somewhere to stop, and
//      R6 measured the meadow two to four milliseconds cheaper without it.
//
//   2. MOST OF A HILL IS NEVER SEEN AND IS NEVER BUILT. The eye stands between
//      1.3 and about 4 m up, inside a plateau 35 m across, and everything here
//      is at least seventy metres away. From there a tread more than five
//      metres up is seen from UNDERNEATH -- it is a back face -- and a flank
//      whose normal points away from the middle of the world never turns toward
//      the eye at all. Dropping both takes the mesh from 632 thousand quads to
//      a hundred thousand WITHOUT CHANGING A PIXEL; the beds and the sectors
//      take it to seventy-five.
//
// The budget §2.9 was written as «≤ 20.000 tri, ≤ 6 draw» for painted quads.
// This keeps it in milliseconds and in delivered bytes and breaks it in
// triangles. R6 §7 proposes the amendment -- milliseconds, draws, card bytes
// and delivered bytes instead of triangles, because the card spends in pixels.
// It is declared in the verbale under REGOLA R4 rather than quietly taking
// another session's margin, and guard-cornice holds the amended numbers.
//
// ===========================================================================
// THE AIR IS READ FROM ITS SEAT AND IS NOT OWNED HERE.
//
// src/world/air.js is frozen and is the coordinator's. What this file binds is
// that seat's own LIVE COLOUR, so that an hour -- or a refit -- moves the hills
// and the meadow together and no band can open between them, which is the one
// thing the join has never been allowed to get wrong.
//
// WHAT THE SEAT DOES NOT YET CARRY IS A DISTANCE TERM, and R6 §3.3 measured why
// that matters out here: `fogAmount` is 0.68 at 185 m, 0.90 at 260 and 0.997 at
// 420, so evaluating it on these hills would flatten all four planes into one
// sheet by three hundred metres, where the reference still holds structure at
// nine hundred. And the reference's air is PER CHANNEL -- blue veils two and a
// half times faster than red -- and turns colour with distance, from the blue
// of the low sky to a pale veil that is LIGHTER than the sky itself.
//
// That law is U-CORNICE-3's to write, D-R6-4 is the committente's to answer,
// and both belong in air.js. So this file does two things and says which is
// which: it READS the seat for the colour, and it carries R6's measurement of
// the per-channel shape as a DECLARED FALLBACK, wired through one `if` so that
// the day air.js publishes `DISTANT_AIR_GLSL` the fallback stops being used and
// can be deleted without touching anything else here.

// The spec is checked where it is cut -- ./distant-mesh.js does it before a
// single cell is asked for, and that is the file both the page and the worker
// reach it through, so asking twice here would be a second opinion about the
// same numbers.
const WATER = waterLevel();

// -------------------------------------------------------------- the air door

const SEAT_HAS_DISTANT_AIR = typeof AIR.DISTANT_AIR_GLSL === 'string';

const FOG_LITERAL = FOG_RADIANCE.map((c) => c.toFixed(4)).join(', ');

const FALLBACK_AIR_GLSL = /* glsl */`
  // NOT THE SEAT'S, AND SAYING SO IS THE POINT OF THE NAME.
  //
  // R6 §2.3 measured the reference's own air per channel -- a quarter of it on
  // red where blue is at nearly two thirds, on the middle crest at four hundred
  // metres -- and a colour that turns from the low sky's blue to a pale veil at
  // L* 77, ten above the sky it stands against. This is that measurement, in
  // the same gaussian form the meadow's fog already has, held here until air.js
  // states it for the whole world.
  //
  // The COLOUR is the seat's, scaled: the ratio below is one at the hour these
  // constants were read at, so nothing moves today and everything moves
  // together the moment the sky does.
  uniform vec3 uAirBeta;
  uniform vec3 uAirDeep;
  uniform vec3 uAirPale;
  uniform float uAirTurn;

  vec3 distantAir(float distance, float height) {
    vec3 depth = uAirBeta * distance;
    return 1.0 - exp(-depth * depth);
  }

  vec3 distantAirColour(float distance) {
    vec3 measured = mix(uAirDeep, uAirPale, 1.0 - exp(-distance / uAirTurn));
    return measured * (uFogColour / vec3(${FOG_LITERAL}));
  }
`;

const AIR_GLSL = SEAT_HAS_DISTANT_AIR ? AIR.DISTANT_AIR_GLSL : FALLBACK_AIR_GLSL;

function airUniforms() {
  const seat = fogUniforms();
  if (SEAT_HAS_DISTANT_AIR) return { ...seat, ...AIR.distantAirUniforms() };
  return {
    ...seat,
    uAirBeta: { value: new Vector3(...SPEC.air.beta) },
    uAirDeep: { value: new Vector3(...SPEC.air.deep) },
    uAirPale: { value: new Vector3(...SPEC.air.pale) },
    uAirTurn: { value: SPEC.air.turn },
  };
}

// ------------------------------------------------------------- the two shaders

// A FACE CARRIES AN INDEX AND NOT A COLOUR, and that is the difference between
// ten megabytes of card and five and a half. There are exactly SIX colours in
// the whole range of hills -- grass and rock, each on a top, a lit flank and a
// shaded one -- so one byte a vertex says which, against twelve for a radiance.
// Nothing is quantised, because six is how many there are; and the palette
// stays a uniform, which is what lets U-CORNICE-2 refit the matter without
// rebuilding a single vertex of the geometry.
const HILL_VERTEX = /* glsl */`
  attribute float shade;
  uniform vec3 uPalette[6];
  varying vec3 vColour;
  varying float vDistance;
  varying float vHeight;
  void main() {
    vColour = uPalette[int(shade + 0.5)];
    vec4 world = modelMatrix * vec4(position, 1.0);
    vDistance = distance(cameraPosition, world.xyz);
    vHeight = world.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const HILL_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec3 vColour;
  varying float vDistance;
  varying float vHeight;
  ${FOG_GLSL}
  ${AIR_GLSL}
  void main() {
    gl_FragColor = vec4(mix(vColour, distantAirColour(vDistance),
      distantAir(vDistance, vHeight)), 1.0);
  }
`;

// THE LAKE IS ONE DISC AND ITS LEVEL IS ASKED FOR, NEVER WRITTEN.
//
// Rectangles used to lie here, each at the depth of the basin at its own
// radius, and from the rim of the plateau their corners showed as edges in the
// water (R6-06). A basin holds ONE lake: the surface is `waterLevel()`, which
// is `basinProfile` at the radius the two arms of the reference's own water
// were read at, so a refit of the fall carries the water with it and cannot
// leave it hanging.
//
// AND THE SHORE IS STILL FOUND AND NOT DRAWN. E-CONF1 put it wherever the
// meadow's terraces come up through this level, decided by the depth buffer
// between two pieces of arithmetic that both answer basinProfile. Nothing here
// changes that, and the hills join it the same way: their feet are AT the
// basin, so they wade in, and there is no line where they meet it either.
const LAKE_VERTEX = /* glsl */`
  varying float vDistance;
  varying float vHeight;
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vDistance = distance(cameraPosition, world.xyz);
    vHeight = world.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const LAKE_FRAGMENT = /* glsl */`
  precision highp float;
  varying float vDistance;
  varying float vHeight;
  varying vec3 vWorld;
  uniform vec3 uWater;
  uniform float uSkyShare;
  ${SKY_GLSL}
  ${SKY_REFLECTION_GLSL}
  ${FOG_GLSL}
  ${AIR_GLSL}
  void main() {
    vec3 view = normalize(vWorld - cameraPosition);
    // Almost flat: enough tilt to break the reflection into the soft horizontal
    // bands the reference shows, and not enough to be a wave.
    vec3 normal = normalize(vec3(
      sin(vWorld.x * 0.19) * 0.012, 1.0, cos(vWorld.z * 0.23) * 0.012));
    vec3 sky = skyReflection(reflect(view, normal));
    // NOT A MIRROR, AND THE SHARE IS MEASURED. R6 §2.5 read the reference's
    // water at L* 53, chroma 28 to 34, hue 203 to 214 -- a teal, darker than
    // the sky at four degrees and much warmer than it, with no cloud legible in
    // it at all. E-V5d said the same thing from the other side. So the sky is a
    // share of this surface and never the whole of it.
    vec3 colour = mix(uWater, sky, uSkyShare);
    gl_FragColor = vec4(mix(colour, distantAirColour(vDistance),
      distantAir(vDistance, vHeight)), 1.0);
  }
`;

// ---------------------------------------------------------------- the delivery

/**
 * The hills, the water, and what the two of them cost.
 *
 * @returns {{meshes: object[], api: object}}
 */
export function createDistance() {
  const hills = new Group();
  hills.name = 'colline';

  const material = new ShaderMaterial({
    uniforms: {
      ...airUniforms(),
      uPalette: { value: palette().map((c) => new Vector3(...c)) },
    },
    vertexShader: HILL_VERTEX,
    fragmentShader: HILL_FRAGMENT,
    fog: false,
  });

  // Past the last ring, so the water always meets the sky and never the ground
  // behind the hills: the disc is the horizon on the bearings the gap opens on.
  const reach = SPEC.rings.frontiers[SPEC.rings.frontiers.length - 1] + 150;
  const disc = new CircleGeometry(reach, 96);
  disc.rotateX(-Math.PI / 2);
  const lake = new Mesh(disc, new ShaderMaterial({
    uniforms: {
      ...airUniforms(),
      ...SKY_UNIFORMS,
      ...SKY_REFLECTION,
      uWater: { value: new Vector3(...SPEC.palette.water) },
      uSkyShare: { value: SPEC.palette.skyShare },
    },
    vertexShader: LAKE_VERTEX,
    fragmentShader: LAKE_FRAGMENT,
    fog: false,
  }));
  lake.name = 'lago';
  lake.position.y = WATER;
  lake.frustumCulled = false;

  const stats = {
    quads: 0,
    triangles: 0,
    bytes: disc.attributes.position.array.byteLength,
    buildMs: null,
    wedges: 0,
    perRing: [],
    air: SEAT_HAS_DISTANT_AIR ? 'air.js' : 'R6 fallback, declared',
    where: 'pending',
  };

  /** Hang one wedge's arrays on the scene, exactly as they arrived. */
  const hang = (wedge) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(wedge.position, 3));
    geometry.setAttribute('shade', new BufferAttribute(wedge.shade, 1));
    geometry.setIndex(new BufferAttribute(wedge.index, 1));
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, material);
    mesh.name = 'collina-settore';
    mesh.frustumCulled = true;
    hills.add(mesh);
  };

  const receive = (built) => {
    for (const wedge of built.wedges) if (wedge) hang(wedge);
    const bytes = stats.bytes + built.stats.bytes;
    Object.assign(stats, built.stats);
    stats.bytes = bytes;
    stats.wedges = hills.children.length;
  };

  // THE CUTTING GOES OFF THE THREAD THE WALKER IS ON, and the fallback under it
  // is not a convenience either.
  //
  // Three seconds, measured -- and measured as a DEAD TAB rather than as a slow
  // frame: the first harness that tried to photograph this world was handed a
  // crashed page. E-CONF1 spent a whole unit bringing the first frame down to
  // about 1.1 s by moving exactly this class of arithmetic onto a worker, and
  // this is that move for that reason. The buffers come back TRANSFERRED, so
  // the answer does not land as a second three-second task on the thread it was
  // taken off.
  //
  // AND IT FALLS BACK TO THIS THREAD RATHER THAN TO NOTHING. Under plain node
  // -- which is where the guards and the benches read these numbers -- there is
  // no Worker at all, and a horizon that existed only inside a browser would be
  // a horizon no guard could ever check.
  if (typeof Worker === 'function') {
    stats.where = 'worker';
    const worker = new Worker(new URL('./distant-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      receive(event.data);
      worker.terminate();
    };
  } else {
    stats.where = 'this thread: no Worker here';
    receive(buildHills());
  }

  return {
    meshes: [hills, lake],
    api: {
      stats,
      /** How many wedges the card is handed at this moment. */
      drawn() {
        return hills.children.filter((m) => m.visible).length + (lake.visible ? 1 : 0);
      },
      setVisible(on) { hills.visible = on; lake.visible = on; },
      /** Whether the hills have arrived from the thread that cuts them. */
      ready() { return hills.children.length > 0; },
      hills,
      lake,
    },
  };
}

// THE CONTRACT V7 IS OWED, ANSWERED BY THE LAW AND FORWARDED FROM HERE.
//
// E-V5a ratified the name and V7 has carried a promissory comment for it ever
// since; E-V5j recorded that the seat in src/world/contracts.js never arrived.
// It arrives now. The answer comes from the law rather than from this file
// because the law is what knows where a terrace is, and this is the door
// contracts.js re-exports, so V7 never reaches into another session's module.
//
// AND A SEAT IS A TREAD NOW. It used to be a height on a painted quad, which is
// what «una panca, non un punto nell'aria» was reaching for when there was
// nothing out there to sit on. There is now.
export function ridgeSeats() {
  return ridgeLampSeats(SPEC, ladders(SPEC));
}

export { SPEC as CORNICE };
