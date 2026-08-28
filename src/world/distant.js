import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, InstancedMesh, Matrix4,
  Mesh, PlaneGeometry, Quaternion, ShaderMaterial, Vector3, Vector4,
} from 'three';
import {
  SKY_GLSL, SKY_REFLECTION, SKY_REFLECTION_GLSL, SKY_UNIFORMS,
} from '../core/sky.js';
import { smoothstep } from './terrain-field.js';
import { fogUniforms, FOG_GLSL, FOG_RADIANCE } from './terrain.js';

// Everything past the meadow: the standing water, the ring of hills, and the
// giants that are not in the reference framing.
//
// None of it is lit. The aerial perspective the reference shows is measured off
// the image itself, because at these distances the haze is not a correction on
// top of the colour, it is most of the colour. A hill twelve hundred metres
// away is very nearly just sky.
//
// WHAT EACH SURFACE SHARES WITH THE AIR IS ITS COLOUR, AND ITS OWN SHARE OF IT.
//
// Until now this was the only thing in the world that knew nothing about the
// haze at all: its colours were constants, so any refit of the air — and the
// obligation to have a night sky guarantees one — would move the meadow's
// horizon and leave the ridges standing where noon left them, with a line
// between them. That is fixed here, and it is fixed by handing every distant
// vertex the fraction of pure air its measured colour contains, so that the
// air's colour arrives at the ridges in exactly the proportion each of them is
// made of it. The foot of the furthest ring is the air, entirely: it and the
// meadow's horizon are now literally one colour, so no refit can open a band
// between them.
//
// WHAT IT DOES NOT TAKE IS THE DISTANCE TERM, and that is measured rather than
// preferred. The height fog of terrain.js, at the density the meadow is
// calibrated at, is 93 per cent at the crest of the nearest ring and saturated
// at every vertex behind it (s2-dev5/VERBALE.md, passo 3). Evaluating it here
// would replace three rings — a lit green band, a blue one behind it, and a
// last one barely separated from the sky, which is what the reference shows —
// with one flat sheet of haze. So the fraction is baked and the colour is live:
// the ridges keep the aerial perspective that was read off the reference, and
// they follow the air wherever it goes.

const DEG = Math.PI / 180;

// The colour of the distance, as radiance.
//
// Every number here was solved rather than chosen: tools/terrain/probe.mjs
// takes a measured rectangle of the reference and inverts the whole composite
// — the AgX curve, the vignette at that point of the frame, the grade — to find
// the radiance a flat surface has to carry for the finished frame to land on
// that colour. These surfaces are unlit and unfogged, so the tint is the answer
// and nothing downstream is allowed to alter it.
//
// What the solve says about the reference is the point of the whole ring: the
// near hills are green and the far ones are blue. Not a green tinted by
// distance fog into blue at draw time, which flattens the ridges into one sheet
// of haze, but three rings each carrying its own colour, and inside each ring a
// slow alternation between a sunlit flank and a shaded one. That alternation is
// what gives the reference its valleys.
//
// Measured against haze-left and haze-right in assets-src/terrain/palette.json.
const NEAR_LIT = new Vector3(0.098, 0.180, 0.163);
const NEAR_SHADE = new Vector3(0.056, 0.116, 0.121);
// Against hill-left-lit and hill-right-lit.
const MID_LIT = new Vector3(0.150, 0.262, 0.288);
const MID_SHADE = new Vector3(0.056, 0.120, 0.162);
// Against hill-left-far and hill-right-far.
const FAR_LIT = new Vector3(0.135, 0.252, 0.382);
const FAR_SHADE = new Vector3(0.088, 0.176, 0.293);
// What is left when there is nothing but air, and what the foot of the furthest
// ridge stands in.
//
// It used to be a fourth measured constant of its own — 0.203, 0.379, 0.643,
// solved off the one column of the reference that is clear sky from the ridge
// line down to the horizon. It is not a constant any more, and that is the
// reconciliation the analysis asked for: the meadow arrives at the horizon
// carrying FOG_RADIANCE and this stood seventeen per cent above it, which is a
// step in level and in tint at exactly the line where the two meet. Air is air.
// The sentinel below means "all of it": whatever the ground's air is, at this
// hour, is what the foot of the furthest ridge stands in.
const HAZE = null;

// There used to be a ring of air under the ridge line as well, seven hundred
// metres out and seven degrees tall. It was not a piece of landscape: the old
// bake stopped being a picture of the sky five and a half degrees above the
// horizon and turned into the flat green filling its lower hemisphere, and
// straight ahead, where the reference shows pale air down to the horizon and no
// hills, that green was a wash across the middle of the framing. The ring was
// what covered it. The sky is a sky down to the horizon and past it now, and
// measured at the framing pose the ring costs what it used to save: the three
// horizon crops read five, three and a tenth and three and three tenths of a
// unit of colour against the reference with it, and one and nine tenths, one
// and one and a tenth without. So it is gone, and what is behind it is the sky.
// The giants stand a quarter of a kilometre out and further, in the same air as
// the last ridge and behind more of it. They were carrying more light than the
// sky they are seen against, which made them white slabs; they are now a shade
// under the air itself, which is what leaves them as silhouettes.
const GIANT = new Vector3(0.108, 0.205, 0.352);

// The most of itself a measured colour may be air.
//
// Past this the split stops being a reading and starts being a division by
// almost nothing: at nine tenths, a tenth of a level of error in the measured
// colour becomes a level in what is left when the air is taken out of it.
const AIR_CAP = 0.9;

/**
 * A measured distant colour, split into what is air and what is not.
 *
 * Returned already multiplied out — the part that is not air is carried as it
 * will be added, not as the colour it would be on its own — so that the whole
 * thing stays linear: the ridges lerp between these along their gradients, and
 * `mix` of two splits has to be the split of the `mix` or the gradient is not
 * the gradient that was measured.
 *
 * The share is the largest one the colour can carry with nothing left over
 * going negative, which is as close to the true optical depth as a single
 * photograph allows anyone to get: the law says a hill at a hundred and fifty
 * metres is ninety three per cent air, and the reference's near hills are
 * plainly greener than that, so the bound is what is honest here and the gap
 * between the two is written down rather than split the difference with.
 *
 * @param {?Vector3} colour  the measured radiance, or null for pure air
 * @returns {Vector4} xyz what is not air, w how much of it is
 */
function splitAir(colour) {
  if (colour === null) return new Vector4(0, 0, 0, 1);
  let share = AIR_CAP;
  for (let c = 0; c < 3; c++) {
    share = Math.min(share, colour.getComponent(c) / FOG_RADIANCE[c]);
  }
  share = Math.max(0, share);
  return new Vector4(
    colour.x - share * FOG_RADIANCE[0],
    colour.y - share * FOG_RADIANCE[1],
    colour.z - share * FOG_RADIANCE[2],
    share,
  );
}

// The reference keeps the middle of its horizon clear and puts its hills at the
// two edges of the frame, where they climb to about six degrees. A ring of even
// height cannot do both: it either draws a bar across the middle of the framing
// or it never rises at the sides. So the profile is gated on the bearing, low
// towards north and full on the flanks, and the gate carries on round the back
// where nothing in this pose can see it.
const GATE_MIN = 0.30;
const GATE_FROM = 10;
const GATE_TO = 42;

// The instanced branch is not optional. Three declares instanceMatrix for a
// shader material only when the object it is drawing is an InstancedMesh, and a
// vertex shader that ignores it collapses every instance onto the origin: the
// six giants came out as one unit box standing on the path in the middle of the
// reference framing, which is the last place any of them may appear.
const UNLIT_VERTEX = /* glsl */`
  attribute vec4 tint;   // xyz what is not air, w how much of it is
  varying vec4 vTint;
  void main() {
    vTint = tint;
    vec4 local = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * local;
  }
`;

const UNLIT_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec4 vTint;
  uniform vec3 uFogColour;
  void main() {
    // One multiply and add: the part of this surface that is not air, plus the
    // air's own colour in the proportion this surface is made of it.
    gl_FragColor = vec4(vTint.rgb + uFogColour * vTint.w, 1.0);
  }
`;

/**
 * A ring of hills, as a single strip.
 *
 * The silhouette is the only thing that carries at this distance, so the
 * geometry is a skirt: a closed run of quads whose top edge is a noise profile
 * and whose bottom edge is buried under the meadow. Modelling the far side of a
 * hill that is never visible would cost triangles for nothing.
 */
function buildRidge({
  radius, height, segments, seed, lit, shade, foot, jitter = 0.35,
}) {
  const positions = [];
  const tints = [];
  const indices = [];

  const wave = (k, frequency, phase) => Math.sin(k * frequency + phase + seed);
  const push = (x, y, z, colour) => {
    positions.push(x, y, z);
    tints.push(colour.x, colour.y, colour.z, colour.w);
  };

  const crest = new Vector4();
  const base = new Vector4();

  for (let k = 0; k <= segments; k++) {
    const t = k / segments;
    const angle = t * Math.PI * 2;
    // Signed bearing from north, which is where the reference framing looks.
    const bearing = Math.abs(((t * 360 + 180) % 360) - 180);
    const gate = GATE_MIN + (1 - GATE_MIN) * smoothstep(GATE_FROM, GATE_TO, bearing);

    // Several turns of different length, so no two hills along the ring are the
    // same and the profile never repeats inside one view.
    const profile = 0.55
      + 0.26 * wave(k, 0.21, 0.0)
      + 0.17 * wave(k, 0.53, 1.7)
      + 0.11 * wave(k, 1.31, 4.2)
      + 0.07 * wave(k, 2.87, 0.6);
    const top = height * Math.max(0.18, profile) * gate;
    const reach = radius * (1 + jitter * 0.12 * wave(k, 0.37, 2.9));
    const x = Math.sin(angle) * reach;
    const z = -Math.cos(angle) * reach;

    // Which flank of the ring the light is on. Slower than the profile, so a
    // whole hill is lit or shaded rather than one alternating with the next.
    const sun = 0.5 + 0.5 * wave(k, 0.09, 1.1);
    crest.copy(shade).lerp(lit, sun);
    // The foot of a hill sits in more air than its crest and reads hazier, and
    // it is also where the ring behind shows through the valleys.
    base.copy(crest).lerp(foot, 0.55);

    // Three rows, not two. The strip used to run straight from six metres below
    // the meadow to the crest, so the haze anchored down there covered most of
    // the band that is actually visible and every ridge came out pale grey. The
    // middle row pins the foot colour at ground level: below it the strip is
    // buried, above it the gradient has only the hill to cross.
    push(x, -6, z, base);
    push(x, 0, z, base);
    push(x, top, z, crest);
  }

  for (let k = 0; k < segments; k++) {
    const a = k * 3;
    const b = (k + 1) * 3;
    for (let row = 0; row < 2; row++) {
      indices.push(a + row, a + row + 1, b + row + 1);
      indices.push(a + row, b + row + 1, b + row);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('tint', new BufferAttribute(new Float32Array(tints), 4));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function ridgeMaterial() {
  return new ShaderMaterial({
    // Only the colour of the air, not its density: the density is baked into
    // the fourth channel of every vertex, for the reason at the top of the file.
    uniforms: { uFogColour: fogUniforms().uFogColour },
    vertexShader: UNLIT_VERTEX,
    fragmentShader: UNLIT_FRAGMENT,
    side: DoubleSide,
    fog: false,
    depthWrite: true,
  });
}

// Standing water in the middle distance. The reference shows two sheets in the
// gaps between the blocks, almost mirror flat and with hardly any contrast:
// they read as sky lying on the ground, so that is how they are drawn.
const LAKE_VERTEX = /* glsl */`
  varying vec3 vWorld;
  varying float vDistance;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vDistance = length(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const LAKE_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec3 vWorld;
  varying float vDistance;

  uniform vec3 uShallow;

  ${SKY_GLSL}
  ${SKY_REFLECTION_GLSL}
  ${FOG_GLSL}

  void main() {
    vec3 view = normalize(vWorld - cameraPosition);
    // Almost flat: a very slight tilt is enough to break the reflection into
    // the soft horizontal bands the reference shows.
    vec3 normal = normalize(vec3(
      sin(vWorld.x * 0.19) * 0.012, 1.0, cos(vWorld.z * 0.23) * 0.012));
    vec3 reflected = reflect(view, normal);

    // Whatever the sky holds in that direction, with no floor under it: these
    // sheets are seen at a hundred metres and reflect the air a degree or two
    // above the horizon, which the sky the world is drawn against now carries
    // for real.
    vec3 sky = skyReflection(reflected);

    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(-view, normal), 0.0), 5.0);
    vec3 colour = mix(uShallow, sky, clamp(fresnel + 0.52, 0.0, 1.0));
    colour = mix(colour, uFogColour, fogAmount(vDistance, vWorld.y));
    gl_FragColor = vec4(colour, 1.0);
  }
`;

// Where the reference puts the water.
//
// Read off the framing rather than placed: the two sheets show up at columns
// 424 to 516 and 944 to 1000, between rows 566 and 590, and a row of the
// framing is a distance for a surface lying flat thirty centimetres above the
// meadow. Those rows put the near edge of each sheet between sixty and eighty
// metres out and carry the far edge past a hundred and fifty, which is a great
// deal further than the sheets used to be: at forty five metres they sat behind
// the westmost blocks and never appeared in the framing at all.
//
// The far half of each sheet is almost entirely fog by the time it is drawn,
// which is where the very low contrast of the reference comes from. It is not
// applied as a separate effect.
const LAKES = [
  { x: -37, z: -104, width: 74, depth: 108, y: 0.30 },
  { x: 14, z: -108, width: 58, depth: 116, y: 0.30 },
];

function hexToLinear(hex) {
  const colour = new Color(hex);
  colour.convertSRGBToLinear();
  return new Vector3(colour.r, colour.g, colour.b);
}

// The giants of the vision.
//
// Bearings are measured from north, which is where the reference framing looks.
// The horizontal field of view at the reference pose is a little over seventy
// degrees, so nothing inside about forty degrees of north may carry one of
// these: at that pose the frame has to stay exactly as the reference shows it,
// and the giants are only found by turning round.
const GIANTS = [
  { bearing: 58, distance: 240, width: 26, height: 96, depth: 14 },
  { bearing: 104, distance: 380, width: 34, height: 150, depth: 18 },
  { bearing: 152, distance: 300, width: 22, height: 110, depth: 12 },
  { bearing: 212, distance: 520, width: 44, height: 210, depth: 22 },
  { bearing: 268, distance: 340, width: 28, height: 128, depth: 16 },
  { bearing: 308, distance: 450, width: 30, height: 165, depth: 15 },
];

// Half the horizontal field of view at the reference pose, plus a margin. Any
// giant inside this of north would appear in a frame that must not have one.
const FRAME_HALF_ANGLE = 44;

function buildGiants() {
  const geometry = new BufferGeometry().copy(
    new PlaneGeometry(1, 1).toNonIndexed(),
  );
  // A slab, not a plane: it has to read as a block from any bearing the walker
  // can reach, and six quads is still one draw call for all of them.
  const box = new BufferGeometry();
  const half = 0.5;
  const corners = [
    [-half, 0, half], [half, 0, half], [half, 1, half], [-half, 1, half],
    [half, 0, -half], [-half, 0, -half], [-half, 1, -half], [half, 1, -half],
  ];
  const quads = [[0, 1, 2, 3], [4, 5, 6, 7], [1, 4, 7, 2], [5, 0, 3, 6], [3, 2, 7, 6]];
  const positions = [];
  const tints = [];
  const giantAir = splitAir(GIANT);
  const pureAir = splitAir(HAZE);
  const blended = new Vector4();
  for (const quad of quads) {
    for (const index of [0, 1, 2, 0, 2, 3]) {
      const corner = corners[quad[index]];
      positions.push(corner[0], corner[1], corner[2]);
      // Baked haze: the foot of a giant is further into the air than its head,
      // so it goes bluer downwards, not upwards. Both ends are splits now, and
      // the blend between them is a blend of splits, which is why the split is
      // carried multiplied out.
      const t = 1 - corner[1] * 0.42;
      blended.copy(giantAir).lerp(pureAir, t * 0.5);
      tints.push(blended.x, blended.y, blended.z, blended.w);
    }
  }
  box.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  box.setAttribute('tint', new BufferAttribute(new Float32Array(tints), 4));
  box.computeBoundingSphere();
  geometry.dispose();

  const mesh = new InstancedMesh(box, ridgeMaterial(), GIANTS.length);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const position = new Vector3();

  GIANTS.forEach((giant, index) => {
    const angle = giant.bearing * DEG;
    position.set(
      Math.sin(angle) * giant.distance,
      -2,
      -Math.cos(angle) * giant.distance,
    );
    // Turned a few degrees off the bearing, so they are never a row of parallel
    // slabs the way a generated ring would be.
    quaternion.setFromAxisAngle(new Vector3(0, 1, 0), angle + (index % 3 - 1) * 0.22);
    scale.set(giant.width, giant.height, giant.depth);
    mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = 'giants';
  mesh.frustumCulled = false;
  return mesh;
}

/** Bearings that would put a giant inside the reference framing. */
export function giantsInFrame() {
  return GIANTS.filter((g) => {
    const bearing = ((g.bearing + 180) % 360) - 180;
    return Math.abs(bearing) < FRAME_HALF_ANGLE;
  });
}

/**
 * Builds the water, the hills and the giants.
 * @param {object} assets  sky texture; everything else is generated
 */
export function createDistance() {
  const meshes = [];

  // Three rings, each further and hazier than the one in front of it. The
  // reference has no more than that: a lit green band, a blue one behind it,
  // and a last one barely separated from the sky.
  const ridges = [
    // Heights are still held down, but by the row the crest reaches rather than
    // by flattening the ring. At the flanks, where the reference has its hills,
    // these three climb to about four and three quarters, five and a third and
    // six degrees: the top of the furthest lands two rows under the lowest hill
    // in the reference, and everything above that stays pure sky, which is the
    // one part of the frame already known to be right.
    {
      radius: 150,
      height: 14,
      segments: 132,
      seed: 0.0,
      lit: splitAir(NEAR_LIT),
      shade: splitAir(NEAR_SHADE),
      foot: splitAir(MID_LIT),
    },
    {
      radius: 260,
      height: 26,
      segments: 108,
      seed: 2.4,
      lit: splitAir(MID_LIT),
      shade: splitAir(MID_SHADE),
      foot: splitAir(FAR_LIT),
    },
    {
      radius: 420,
      height: 46,
      segments: 96,
      seed: 5.1,
      lit: splitAir(FAR_LIT),
      shade: splitAir(FAR_SHADE),
      foot: splitAir(HAZE),
    },
  ];
  // Everything out here is opaque and depth tested, so the order it is drawn in
  // is the order the depth buffer decides. What it may not do is share a render
  // order with the sky: the sky is drawn with the depth test off, so that it can
  // be laid down first without a far plane, and anything queued alongside it is
  // liable to be painted over. It sits at minus one; the distances sit at zero
  // with the rest of the world, and the ridges and the meadow then resolve
  // against each other by depth alone.
  for (const spec of ridges) {
    const ridge = new Mesh(buildRidge(spec), ridgeMaterial());
    ridge.name = `ridge-${spec.radius}`;
    ridge.frustumCulled = false;
    meshes.push(ridge);
  }

  // Nothing to wait for: the sky these sheets reflect is evaluated, not
  // delivered.
  let water = null;
  {
    water = new ShaderMaterial({
      uniforms: {
        ...SKY_UNIFORMS,
        ...SKY_REFLECTION,
        uShallow: { value: hexToLinear('#3d4f57') },
        ...fogUniforms(),
      },
      vertexShader: LAKE_VERTEX,
      fragmentShader: LAKE_FRAGMENT,
      fog: false,
    });
    for (const lake of LAKES) {
      const mesh = new Mesh(new PlaneGeometry(lake.width, lake.depth), water);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(lake.x, lake.y, lake.z);
      mesh.name = 'lake';
      meshes.push(mesh);
    }
  }

  meshes.push(buildGiants());
  return {
    meshes,
  };
}
