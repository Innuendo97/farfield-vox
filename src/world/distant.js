import {
  BufferAttribute, BufferGeometry, Group, Mesh, RingGeometry, ShaderMaterial, Vector3,
} from 'three';
import { SKY_GLSL, SKY_REFLECTION, SKY_REFLECTION_GLSL, SKY_UNIFORMS } from '../core/sky.js';
import { FOG_GLSL, fogUniforms } from './air.js';
import { CONFINE, waterLevel } from './voxel/confine.js';
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
// THE AIR COMES FROM ITS SEAT, ALL OF IT, AND THE FALLBACK IS GONE.
//
// src/world/air.js is frozen and is the coordinator's. This file binds the
// seat's own uniforms, so that an hour -- or a refit -- moves the hills and the
// meadow together and no band can open between them, which is the one thing
// the join has never been allowed to get wrong.
//
// WHAT THE SEAT DID NOT CARRY WHEN U-CORNICE-1 SHIPPED WAS A DISTANCE TERM.
// `fogAmount` alone is 0.68 at 185 m, 0.90 at 260 and 0.997 at 420, so
// evaluating it out here flattened all four planes into one sheet by three
// hundred metres where the reference still holds structure at nine hundred; and
// the reference's air is PER CHANNEL, the blue veiling two and a half times
// faster than the red, towards a colour that turns from the low sky's blue to a
// pale veil LIGHTER than the sky itself. So this file carried R6's own
// measurement of that shape behind an `if`, declared as a fallback, with the
// name of the door it was waiting for.
//
// E-LUCE4 opened it. `air.js` now states the whole of it -- two terms, the low
// haze capped at 0.13 and a per-channel distance towards a turning colour, in
// `throughAir(colour, distance, height)` -- fitted against the same readings
// R6 published and landing on its red and green to three digits. The fallback,
// its four uniforms and the `if` over them are DELETED rather than left dark:
// two laws for one sky is how a band opens between the meadow and the hills,
// and the second one no longer has an excuse to exist.

// The spec is checked where it is cut -- ./distant-mesh.js does it before a
// single cell is asked for, and that is the file both the page and the worker
// reach it through, so asking twice here would be a second opinion about the
// same numbers.
const WATER = waterLevel();

// ------------------------------------------------------------- the two shaders

// A FACE CARRIES AN INDEX AND NOT A COLOUR, and that is the difference between
// ten megabytes of card and five and a half. There are exactly SIX colours in
// the whole range of hills -- grass and rock, each on a top, a lit flank and a
// shaded one -- so one byte a vertex says which, against twelve for a radiance.
// Nothing is quantised, because six is how many there are; and the palette
// stays a uniform, which is what lets U-CORNICE-2 refit the matter without
// rebuilding a single vertex of the geometry.
//
// AND THAT CHOICE HAS NOW BEEN SPENT A SECOND TIME, WHICH IS THE POINT OF
// RECORDING IT. U-CORNICE-2 solved these six WITH THE AIR SWITCHED OFF -- the
// only way it had of isolating the three channels -- so what it shipped was the
// near flank's own APPEARANCE, the reference's first 227 metres of air included.
// Every metre this world then put in front of them was that air counted twice.
// D-L8-2 = B ordered it re-solved the other way round, and U-CORNICE-4 did:
// the six radiances are what the surface has to EMIT so that the picture falls
// on the reference with everything the delivered air puts in front of the plane
// each class is measured on. rms on R6's three planes 12.79 -> 6.42, the near
// flank exactly on its own class mask, and -- because they are a uniform and
// nothing else -- not one vertex re-cut, not one byte re-delivered and, on the
// card's own clock, nothing to pay: every arm of the measurement sits inside the
// instrument's own scatter (±0.43 ms on a total of 20).
//
// WHAT IT COST INSTEAD IS THE BLUE, and that belongs in this file because it is
// a fact about the AIR and not about the hills. The low haze's ceiling is a MIX:
// past sixty-three metres it puts 0.0992 of blue in front of every surface out
// here, and the whole of what the reference shows at the near flank is 0.1040.
// So a pigment solved with that in front of it has four thousandths of blue left
// to be blue with, and three of the six come out at nought exactly. The hills'
// blue is the ceiling's now, not the rock's. That is E-LUCE2's number and
// D-L8-1's decision, gated in guard-cornice where it can be seen.
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
  void main() {
    gl_FragColor = vec4(throughAir(vColour, vDistance, vHeight), 1.0);
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
    //
    // AND THE SHARE WAS COUNTING THE SKY TWICE, exactly as the hills' palette
    // was counting the air twice, and for the same reason. R6 solved uWater by
    // INVERTING the reference's own lake pixel -- «colore invertito dal target,
    // lin 0,0245 / 0,163 / 0,169» -- which is the water with the sky ALREADY
    // reflected in it, and then twenty-eight per cent of this sky went on top.
    // Measured: at 268 m the sky this surface reflects develops to 134/185/219,
    // so 0.28 of it plus the low haze's ceiling puts the lake at 72/132/173 WITH
    // BLACK WATER UNDERNEATH -- forty-seven levels of blue over the reference,
    // with nothing left to take away. U-CORNICE-4 re-solved both halves: the
    // share is 0.05 and the water is its own colour under it.
    //
    // WHY 0.05 AND NOT THE FIT'S OWN ANSWER, said plainly because the fit has
    // not got one. Between 200 and 500 m the reflected sky moves less than a
    // degree and a half of elevation, so every share under six per cent delivers
    // the SAME three numbers once the water is re-solved beneath it: the picture
    // cannot tell them apart. What decides it is this file's other duty -- the
    // hour has to move the lake, and a water with no colour of its own is a
    // mirror wearing a hat. Five per cent is the largest share at which the
    // solved water still has blue of its own (0.0164); at six it is nought and
    // the sky is carrying all of it again.
    //
    // WHAT IS STILL MISSING, AND IT IS GEOMETRY AND NOT COLOUR. The reference's
    // water carries a gradient this surface cannot make: its far end is darker
    // and greener than its near end, because at half a degree of grazing it is
    // reflecting the FAR SHORE and not the sky. skyReflection() has only the
    // dome to give it. Declared, not defended.
    vec3 colour = mix(uWater, sky, uSkyShare);
    gl_FragColor = vec4(throughAir(colour, vDistance, vHeight), 1.0);
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
      ...fogUniforms(),
      uPalette: { value: palette().map((c) => new Vector3(...c)) },
    },
    vertexShader: HILL_VERTEX,
    fragmentShader: HILL_FRAGMENT,
    fog: false,
  });

  // A RING, AND NOT A DISC THAT REACHES UNDER THE MEADOW.
  //
  // U-CORNICE-1 laid a circle of 2300 m at the surface and never culled it, and
  // measured what that costs at the one pose that looks at the water across the
  // whole frame: the rim, where the frame went from 37.5 to 41.1 ms -- the only
  // one of the three poses where the hills LOST. It is its residue (6) and this
  // is the lever it named.
  //
  // Two things were being paid for and neither was seen. The inner circle out
  // to the meadow's own shore lies UNDER the meadow, which draws every pixel of
  // that ground and writes its depth -- so on the rim pose, where the near
  // water fills the bottom of the frame, the card was shading the reflection of
  // the sky on a surface hidden behind a hillside two metres in front of it.
  // AND IT IS STILL ONE DRAW, WHICH WAS TRIED THE OTHER WAY FIRST. Cut into the
  // hills' own sixteen wedges the ring is frustum-culled -- and measured, the
  // frame's draw count went from seventeen of cornice to thirty-two of them,
  // because a wedge that spans two kilometres of radius has a bounding sphere a
  // kilometre wide and the lens is inside most of them. It bought nothing
  // either: a wedge behind the walker draws no pixels, and a flat ring's whole
  // cost is the pixels. So the wedges are the hills' -- where the geometry is
  // -- and the water is one call, as the budget was written for.
  //
  // THE INNER EDGE IS ASKED FOR AND NOT TYPED, and it is put two metres INSIDE
  // the shore rather than on it. `CONFINE.waterAt` is where the fall crosses
  // the surface on the open bearings; the terraces wade further in on some of
  // them, and a ring that started exactly at the level's own radius would leave
  // the width of one riser of daylight between the water and the ground on any
  // bearing where the shore came in. Two metres inside, the meadow is a metre
  // of dry ground proud of the water and there is nothing to open.
  const reach = SPEC.rings.frontiers[SPEC.rings.frontiers.length - 1] + 150;
  const shore = CONFINE.waterAt - 2;
  const disc = new RingGeometry(shore, reach, 96, 1);
  disc.rotateX(-Math.PI / 2);
  const lake = new Mesh(disc, new ShaderMaterial({
    uniforms: {
      ...fogUniforms(),
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
  // IT SURROUNDS THE WALKER, SO THERE IS NOTHING FOR A FRUSTUM TO CULL. One
  // bounding sphere around a ring two kilometres across is in the lens from
  // everywhere inside it, and a sphere test that always says yes costs the test.
  lake.frustumCulled = false;
  const lakeBytes = disc.attributes.position.array.byteLength;

  const stats = {
    quads: 0,
    triangles: 0,
    bytes: lakeBytes,
    buildMs: null,
    wedges: 0,
    perRing: [],
    air: 'air.js: throughAir',
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
      /**
       * How many objects the cornice OFFERS the card -- not how many it draws.
       *
       * The frustum's own culling is decided inside the renderer and never
       * touches `visible`, so nothing outside it can count what was actually
       * submitted. What a bench wants is the renderer's own drawCalls with the
       * cornice on and off, and the difference between the two; this is the
       * ceiling that difference is read against.
       */
      drawn() {
        if (!hills.visible && !lake.visible) return 0;
        return (hills.visible ? hills.children.length : 0) + (lake.visible ? 1 : 0);
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
