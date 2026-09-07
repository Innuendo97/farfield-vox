import {
  BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector3, Vector4,
} from 'three';
import {
  SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS, SKY_GLSL, SKY_REFLECTION,
  SKY_REFLECTION_GLSL, SKY_UNIFORMS,
} from '../core/sky.js';
import { FOG_GLSL, LOW_SKY, fogUniforms } from './air.js';
import { faceLightGlsl, faceLightUniforms } from './face-light.js';
import { VOXEL } from './voxel/pure.js';
import { voxelSettings } from './voxel/material.js';
import {
  MOSS_TINT, SKY_BLUR, STONE_ARRIS, STONE_ARRIS_PIGMENT,
  STONE_ARRIS_PIXELS, STONE_EXPOSURE, STONE_F0, STONE_GAIN, STONE_JOINT,
  STONE_JOINT_PIXELS, STONE_LIGHT_SCALE, STONE_RIM, STONE_RIM_POWER,
  STONE_TINT,
} from './voxel/masonry.js';
import {
  EARTH_COURSE, ROCK_BLOCKERS, ROCK_PILES, SLAB, SLAB_FALLOFF, SLAB_REACH,
  SLAB_SHARE, footOf, meshPile, pileCensus,
} from './rock-piles.js';

// The rocks.
//
// Two of them do a job nothing else in the scene does: in the reference a dark
// mass fills the bottom left corner and a group of boulders fills the bottom
// right, and between them they close the composition at the near edge. Their
// positions are not a matter of taste — the pixels they occupy were traced back
// through the reference camera onto the meadow by tools/vegetation/plan-rocks.
//
// AND NOT ONE OTHER THING ABOUT THEM IS DELIVERED ANY MORE. What stood here was
// a glTF scene of ten decimated spheres, a Cycles bake of the light on them, a
// manifest naming the sun that bake was lit by, and an albedo inverted out of a
// hand-sampled palette. All four are gone, and each one went for its own
// reason:
//
//   THE MESH, because a decimated sphere cannot show what this world is about.
//   The one place in either target where three orientations of ONE material can
//   be told apart BY GEOMETRY rather than by brightness is the stone cluster
//   east of the eye, and it is the recipe's own window for that reading. A
//   sphere has no orientations. A pile of cubes is nothing but orientations —
//   at that range the fitted camera gives a 0.20 m face twenty-three pixels, so
//   a top, a west flank and a south flank are three things the eye can name.
//
//   THE BAKE, because there is no renderer outside this repository authoring
//   light any more. The two terms of a face are arithmetic in the fragment over
//   the one direction src/core/sky.js carries, exactly as they are for the
//   meadow and for the wall.
//
//   THE MANIFEST, because it was the last consumer of the old sun on the roster
//   of waivers, and a waiver is a debt that is paid by retiring the thing, not
//   by carrying it.
//
//   THE PALETTE, because it was the last consumer of
//   assets-src/vegetation/palette.json in the whole world, and the palette's
//   rock entries were readings INVERTED THROUGH THE OLD LIGHT SEAT — a sun at
//   elevation 34 and azimuth -9.5 that no longer exists. An albedo divided by
//   the wrong light is not a measurement of a pigment; it is a measurement of a
//   disagreement. The stone of the rocks is now the stone of the wall, from the
//   seat that was fitted against the target face by face.
//
// WHAT IS NOT CLAIMED. The exposure did not move: the wall's own
// STONE_LIGHT_SCALE x STONE_EXPOSURE is 1.5 x 1.25, and what the bake manifest
// asked for was 1.5 x GROUND_EXPOSURE, which is 1.5 x 1.25. The rocks are lit
// at exactly the level they were lit at, by a different route.

// -------------------------------------------------------------- the families
//
// Two pigments that are NOT the wall's, and one that is somebody else's on
// purpose.
//
// THE EARTH where the stone breaks the turf. In both targets a rock does not
// sit ON the meadow, it sits IN it: there is a course of bare ground at the
// foot of every pile, and without it a rock reads as a prop dropped on a lawn.
// The colour is the meadow's own pigment turned to earth — the same green
// carried to a brown of the same level, so it belongs to this ground rather
// than to a paint chart: red and green swapped in weight, blue held down. It is
// DECLARED and not measured, and it says so: the targets draw this band at four
// or five pixels and no window of it survives an estimator.
const EARTH_ALBEDO = [0.245, 0.170, 0.085];

// AND THE CUBE OF TURF ON SOME HEADS IS THE MEADOW'S OWN GREEN, read from the
// seat that produces it and not copied. That is the whole point of it being
// there: the reference shows turf that has climbed a low rock and stopped, so
// what is standing on that stone is the same grass as the grass beside it, and
// a second green here would be the palette all over again in one line.
const TURF_ALBEDO = voxelSettings().albedo;

// ----------------------------------------------------------------- the grain
//
// HOW OFTEN THE STONE TILE REPEATS ON A ROCK, IN METRES — and this is the one
// number of this material that is neither the wall's nor a declaration, because
// it is the one the mandate says not to economise on.
//
// The wall repeats its tile every 1.6 m, which is right for a wall: a course is
// 0.22 m and a block about the same, so a face carries several blocks and the
// tile's slow octaves are what separate them. A rock's face is 0.10 or 0.20 m.
// At 1.6 m a whole rock face would sit inside an eighth of one tile cell and
// read FLAT — which is the thing the recipe measures and calls out: on the
// target a face of stone breaks into about three regions across (0.31x its own
// size) where a face of grass stays one (1.02x).
//
// So the tile is wound tighter here, and the value is FITTED against that
// estimator rather than chosen: swept, and the reading is in the verbale beside
// what the wall's own fronts measure (0.45 to 0.63x).
const ROCK_TILE_METRES = 0.55;

// AND THE ROCKS ARE A SECOND STONE, WHICH IS A CORRECTION TO "ONE STONE, ONE
// SEAT" AND NOT AN ESCAPE FROM IT.
//
// The doctrine was right about the wall and wrong about the world: the
// reference does not have one stone, it has two, and the two are half a
// lightness apart. Measured on the day target through one estimator
// (R5 SS1.8), the low right cluster's lit caps read 130 / 124 / 104 -- L* 50.5,
// chroma 13.4, HUE 95, which is a warm beige -- while the wall's own lit stone
// reads L* 31 at hue 142 to 190. The same two stones build the low ruins past
// 05 (lit faces L* 53, hue 89), which is the same rock and not the same wall.
//
// Ours were drawn from the wall's pigment and came out at hue 122 to 125: a
// cold cap with the sky in it. Half of that was the grazing term, and it is
// gone from the seat above; the other half is that a beige rock cannot be made
// of grey stone. So the rock takes its OWN albedo and everything else about the
// material -- the grain, the joint, the dressed edge, the moss, the exposure --
// stays the wall's, which is what the doctrine was actually protecting.
//
// The residual is declared rather than fitted away: the target's DARK faces on
// the same cluster read L* 12.8, near black, and no pigment brings ours below
// about 26 while the vertical faces of this world receive the sky and the
// meadow's bounce that they do (R5 SS3, S6, and D5's list).
// EXPORTED, and for the reason every triple in this campaign that has two
// readers is exported: src/world/loose-stone.js cuts the squared ruins in the
// grass out of THIS stone -- R5 SS7 says they are the same pale stone -- and a
// second copy of these three numbers is a second opinion about what the pale
// stone of this world looks like, which is the defect the fit above was written
// to close.
export const ROCK_ALBEDO = [0.50, 0.47, 0.38];

// AND HOW MUCH OF THE SKY A ROCK TAKES, which is the wall's own bend at a
// different number for a shape that is not a wall.
//
// A pile of cubes on open grass sees more sky than a flat face of a monolith
// does, and less of it than the seat hands a plane -- but what actually sets
// this is the reading: the target's dark rock faces are the darkest stone in
// the picture. 0.35 is where the sweep behind R5 SS3 (S6) left it, and the miss
// that remains is written above.
const ROCK_SKY_SHARE = 0.35;

// The most piles the fragment can be handed. A uniform array has to be a fixed
// size, and it is stated here so that an eleventh rock is a thing somebody has
// to come and change rather than a thing that quietly draws the eleventh with
// the tenth's foot under it.
const MAX_PILES = 12;

// ------------------------------------------------------------------ the moss
//
// The law the retired material carried, kept because it was a reading and not a
// convenience: moss grows on what looks up and low down, and it is a PIGMENT
// and never a light. What has changed is where the green comes from — the
// wall's own MOSS_TINT, which is the seat the six blocks are mossed from — so
// the moss on a rock and the moss on a monolith are one colour.
// How much of a face that CAN carry moss actually does, how coarse a patch is
// in metres, and how far up from the foot the wet band reaches. The first is
// the level the retired material shipped at (0.40 to 0.78 over the patch,
// averaging 0.59) written as one number, so that turning it is turning one
// thing.
const MOSS_COVER = 0.62;
const MOSS_SCALE = 0.34;
const MOSS_LOW = 0.42;

/** Where the rocks stand, for whoever needs to know: the vegetation, the walker. */
export const ROCKS = ROCK_PILES.map((rock) => ({
  name: rock.name,
  role: rock.role,
  x: rock.x,
  z: rock.z,
  radius: rock.radius,
  height: rock.height,
}));

export { ROCK_BLOCKERS };

const VERTEX = /* glsl */`
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDistance;

  void main() {
    // IN THE WORLD AND NOT IN A LOCAL FRAME, which is the opposite of what the
    // wall does and is right for the same reason the wall is right. A block is
    // turned and stands on its own, so its own frame is where its law is
    // written; the piles are ten objects welded into one buffer with no turn
    // between them, and the lattice they all sit on IS the world's. A local
    // frame here would need an origin per pile, which is the attribute the
    // merge cannot carry.
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vDistance = length(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */`
  precision highp float;

  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDistance;

  uniform sampler2D tStone;
  uniform float uVoxel;
  uniform float uTile;
  uniform vec3 uAlbedo;
  uniform vec3 uEarth;
  uniform vec3 uTurf;
  uniform float uGain;
  uniform float uTint;
  uniform float uJoint;
  uniform float uJointPixels;
  uniform float uArris;
  uniform float uArrisPixels;
  uniform float uArrisPigment;
  uniform float uMoss;
  uniform float uMossScale;
  uniform float uMossLow;
  uniform vec3 uMossTint;
  uniform float uF0;
  uniform float uRim;
  uniform float uRimPower;
  uniform float uSkyBlur;
  uniform vec3 uLowSky;
  uniform float uEarthCourse;
  uniform float uSlab;
  uniform float uSlabShare;
  uniform float uSlabFalloff;
  uniform float uSlabReach;
  uniform float uSkyShare;

  // The piles: where each one stands and what its foot is, and which cell of
  // the world carries its cube of turf. Two vectors and a count, which is the
  // whole of what a fragment needs to know that a merged buffer cannot tell it.
  uniform vec4 uPile[${MAX_PILES}];   // (x, z, foot, seed)
  uniform vec4 uCap[${MAX_PILES}];    // (cell x, cell y, cell z, 1 if it has one)
  uniform int uPiles;

  ${SCENE_LIGHT_GLSL}
  ${SKY_GLSL}
  ${faceLightGlsl({ sunDeclared: true })}
  ${SKY_REFLECTION_GLSL}
  ${FOG_GLSL}

  // The hash the whole world is laid on: three multiplies, a dot and two
  // fracts, and src/world/voxel/courses.js does the same arithmetic in single
  // precision so the geometry and the fragment agree rather than nearly agree.
  vec2 stoneHash(float x, float y, float z) {
    vec3 p = fract(vec3(x, y, z) * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract(vec2((p.x + p.y) * p.z, (p.y + p.z) * p.x));
  }

  void main() {
    vec3 n = normalize(vNormal);

    // ------------------------------------------------------- which cube is this
    //
    // Half a step back along the normal, so a face lands inside the solid it
    // belongs to instead of on the boundary between two — on the boundary the
    // floor below flickers between neighbours and the tint of a whole flank
    // crawls as the eye moves. The same line, for the same reason, as
    // src/world/voxel/material.js.
    vec3 p = vWorld - n * (uVoxel * 0.5);
    vec3 cell = floor(p / uVoxel);

    // ------------------------------------------------------------ which pile
    //
    // The nearest by its foot in plan. Ten piles, no texture, no attribute:
    // they stand metres apart, so nearest-in-plan is not an approximation of
    // which pile this is, it IS which pile this is.
    float foot = 0.0;
    float seed = 0.0;
    vec4 cap = vec4(0.0);
    float best = 1e9;
    for (int i = 0; i < ${MAX_PILES}; i++) {
      if (i >= uPiles) break;
      vec2 d = vWorld.xz - uPile[i].xy;
      float away = dot(d, d);
      if (away < best) {
        best = away;
        foot = uPile[i].z;
        seed = uPile[i].w;
        cap = uCap[i];
      }
    }
    float up = p.y - foot;

    // ------------------------------------------------------------ which piece
    //
    // A slab is a 2x2x2 super-cell of the world lattice, laid or not laid by
    // one draw of the hash — the same draw src/world/rock-piles.js built the
    // geometry with, on the same three whole numbers. Laid, the eight cells are
    // ONE 0.20 m piece and the joint runs round the outside of it; not laid,
    // each cell is its own piece. That is what "mixed sizes" is, and it is
    // rebuilt here rather than stored because a rectangle standing for forty
    // cells cannot say which of the forty a corner is in.
    vec3 super = floor(cell / uSlab);
    float share = uSlabShare * (1.0 - uSlabFalloff * clamp(up / uSlabReach, 0.0, 1.0));
    bool slab = stoneHash(super.x * 3.0 + seed, super.y * 5.0, super.z * 7.0 - seed).y < share;
    float pitch = slab ? uSlab * uVoxel : uVoxel;
    vec3 piece = slab ? super : cell;

    // ------------------------------------------------------------- the family
    //
    // Earth at the foot, turf on the one cell that carries it, stone
    // everywhere else. Both are facts about WHERE, so both are answered from
    // the fragment's own position and the two numbers the pile handed over.
    float earth = step(up, uEarthCourse * uVoxel - 0.001);
    float turf = cap.w * step(abs(cell.x - cap.x) + abs(cell.y - cap.y)
      + abs(cell.z - cap.z), 0.5);

    // ---------------------------------------------------------------- the tile
    //
    // In the two world axes the face does NOT look along, which is what keeps
    // one piece's grain continuous across its own corner. The tile is a height
    // as well as a shade, so a second fetch a step up-sun is the slope along
    // the only direction a sun cares about.
    vec3 a = abs(n);
    vec2 face = a.y > 0.5 ? p.xz : (a.x > 0.5 ? p.zy : p.xy);
    vec2 tile = face * uTile;
    vec2 pair = texture2D(tStone, tile).rg;

    vec3 albedo = uAlbedo * (1.0 + uGain * (pair.r - 0.5));

    // ----------------------------------------------------------- the tint
    //
    // Per PIECE and not per cell, which is the difference between a pile of
    // stones and a heap of dice: the eight cells of a laid slab draw one
    // number, so the slab is one colour and its neighbour is another.
    vec2 draw = stoneHash(piece.x, piece.y, piece.z);
    albedo *= 1.0 + uTint * (draw.x - 0.5);

    // ------------------------------------------------------------- the moss
    //
    // On what looks up and low down, which is the law the retired material
    // carried and the one thing about it worth keeping. It is a PIGMENT: at
    // night the moss goes dark with the stone it is on, and anything drawn as
    // an emissive would be the one green thing in a night frame.
    float lookingUp = clamp(n.y, 0.0, 1.0);
    float low = 1.0 - smoothstep(uMossLow * 0.2, uMossLow, up);
    vec2 spot = face / uMossScale;
    vec2 base = floor(spot);
    vec2 t = spot - base;
    t = t * t * (3.0 - 2.0 * t);
    float m0 = stoneHash(base.x, base.y, 61.0).x;
    float m1 = stoneHash(base.x + 1.0, base.y, 61.0).x;
    float m2 = stoneHash(base.x, base.y + 1.0, 61.0).x;
    float m3 = stoneHash(base.x + 1.0, base.y + 1.0, 61.0).x;
    float field = mix(mix(m0, m1, t.x), mix(m2, m3, t.x), t.y);
    // THE GOING-IN AND THE COMING-OUT ARE TWO DIFFERENT NUMBERS, which is the
    // half of this law that is easy to lose. The test says WHERE moss can be —
    // what looks up, near the grass — and the second factor says how much of it
    // is actually there; the noise goes into the test rather than onto the
    // result, so the rim of a patch wanders across the stone instead of fading
    // out of it. Written with one number the whole crown of a pile comes back
    // green, which is what a first pass of this did.
    float moss = smoothstep(0.74, 1.16, lookingUp * (0.62 + 0.76 * field) + low * 0.20);
    moss *= uMoss * (0.40 + 0.38 * field);
    moss *= 1.0 - earth;
    albedo = mix(albedo, albedo * uMossTint, moss);

    // Earth and turf take the whole pigment rather than tinting it: they are
    // different materials standing in the same pile, not stone in a mood.
    albedo = mix(albedo, uEarth * (0.86 + 0.34 * pair.r), earth);
    albedo = mix(albedo, uTurf * (1.0 + 0.30 * (draw.y - 0.5)), turf);

    // ------------------------------------------------------------- the joint
    //
    // Round the outside of a PIECE, held in pixels so it stays a line at every
    // distance and let go once a piece is too small to have an inside. Six per
    // cent over one or two pixels is the reading, and it is the wall's own
    // number because it is the same stone.
    float pixel = max(length(fwidth(p)), 1e-6);
    vec3 within = abs(fract(p / pitch) - 0.5);
    vec3 across = mix(within, vec3(0.5), a);
    float border = (0.5 - max(across.x, max(across.y, across.z))) * pitch;
    float onScreen = pitch / pixel;
    float width = min(uJointPixels * pixel, pitch * 0.14);
    albedo *= 1.0 - uJoint * (1.0 - smoothstep(0.0, width, border))
      * smoothstep(2.5, 5.0, onScreen);

    // ----------------------------------------------------------- the light
    //
    // The pair is bent the way the wall bends it and for the same reason: this
    // is a material taking less of the sky than an open plane does, not a
    // second opinion about where the sun is. uLift is untouched.
    vec2 terms = faceTerms(n);
    terms.y *= uSkyShare;
    vec3 light = faceLightOf(terms);

    // ------------------------------------------------- the lightened arris
    //
    // The top edge of a piece is not painted paler, it is a facet leaning up,
    // so it is handed the light of a facet leaning up and its brightness and
    // its blue both fall out of that. Only on the flanks: a top face has no
    // upper edge to catch. And the dressed stone carries the wall's pigment on
    // it, because a cut edge on weathered stone is freshly broken face.
    float top = fract(p.y / pitch);
    float band = min(uArrisPixels * pixel, pitch * 0.30) / pitch;
    float arris = smoothstep(1.0 - band, 1.0, top)
      * (1.0 - abs(n.y)) * uArris * smoothstep(2.5, 5.0, onScreen);
    if (arris > 0.0) {
      vec3 leaning = normalize(n + vec3(0.0, 1.0, 0.0));
      light = mix(light, faceLightOf(faceTerms(leaning)), arris);
    }
    albedo *= mix(1.0, uArrisPigment, arris * (1.0 - earth) * (1.0 - turf));

    vec3 colour = albedo * light;

    // --------------------------------------------------------- the sky in it
    //
    // The wall's own pair, and they are the wall's for the reason the wall
    // states: a flat face presents ONE angle over its whole area, so a grazing
    // gain fitted on a curved flank lights the entire face and the stone reads
    // as sky. These rocks are flat faces now. The numbers that were here before
    // were fitted for a sphere.
    vec3 view = normalize(vWorld - cameraPosition);
    vec3 mirrored = reflect(view, n);
    vec3 sky = skyReflection(mirrored, uSkyBlur);
    sky = mix(uLowSky, sky, smoothstep(0.12, 0.38, mirrored.y));
    float fresnel = uF0 + uRim * pow(1.0 - clamp(dot(-view, n), 0.0, 1.0), uRimPower);
    colour += sky * fresnel * (1.0 - moss * 0.6);

    colour = mix(colour, uFogColour, fogAmount(vDistance, vWorld.y));
    gl_FragColor = vec4(colour, 1.0);
  }
`;

/**
 * Every pile as one mesh, and one draw.
 *
 * TEN OBJECTS WELDED INTO ONE BUFFER, exactly as the delivered rocks were: they
 * share one material and one tile, and drawn separately they would be ten draw
 * calls for a shape that covers a twentieth of the frame. This layer is already
 * one draw over its allocation and nothing here is allowed to make that two.
 *
 * AND NOTHING PER CELL IS UPLOADED. Positions, normals and indices; which pile,
 * which piece, which family, how the tile lies and what tint it took are all
 * rebuilt in the fragment out of its own position and the two vectors a pile
 * carries. The old mesh handed over a per-vertex `aFoot` for exactly one of
 * those questions; twelve uniforms answer it now and the buffer is three
 * attributes lighter.
 */
export function createRocks({ tile = null } = {}) {
  const positions = [];
  const normals = [];
  const indices = [];
  const piles = [];
  const caps = [];
  let quads = 0;
  let faces = 0;

  for (const rock of ROCK_PILES.slice(0, MAX_PILES)) {
    const foot = footOf(rock);
    const built = meshPile(rock, foot);
    const base = positions.length / 3;
    for (const value of built.positions) positions.push(value);
    for (const value of built.normals) normals.push(value);
    for (const index of built.indices) indices.push(index + base);
    quads += built.quads;
    faces += built.faces;
    piles.push(new Vector4(rock.x, rock.z, foot, rock.seed));
    caps.push(built.cap
      ? new Vector4(built.cap.x, built.cap.y, built.cap.z, 1)
      : new Vector4(0, 0, 0, 0));
  }
  // The padding stands at the last real pile, so a fragment that reaches past
  // the end can only be told about a pile that exists.
  while (piles.length < MAX_PILES) {
    piles.push(piles[piles.length - 1].clone());
    caps.push(new Vector4(0, 0, 0, 0));
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setIndex(new BufferAttribute(
    positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), 1));
  geometry.computeBoundingSphere();

  const material = new ShaderMaterial({
    uniforms: {
      tStone: { value: tile },
      uVoxel: { value: VOXEL },
      uTile: { value: 1 / ROCK_TILE_METRES },
      uAlbedo: { value: new Vector3(...ROCK_ALBEDO) },
      uEarth: { value: new Vector3(...EARTH_ALBEDO) },
      uTurf: { value: new Vector3(TURF_ALBEDO.x, TURF_ALBEDO.y, TURF_ALBEDO.z) },
      uGain: { value: STONE_GAIN },
      uTint: { value: STONE_TINT },
      uJoint: { value: STONE_JOINT },
      uJointPixels: { value: STONE_JOINT_PIXELS },
      uArris: { value: STONE_ARRIS },
      uArrisPixels: { value: STONE_ARRIS_PIXELS },
      uArrisPigment: { value: STONE_ARRIS_PIGMENT },
      uMoss: { value: MOSS_COVER },
      uMossScale: { value: MOSS_SCALE },
      uMossLow: { value: MOSS_LOW },
      uMossTint: { value: new Vector3(...MOSS_TINT) },
      uF0: { value: STONE_F0 },
      uRim: { value: STONE_RIM },
      uRimPower: { value: STONE_RIM_POWER },
      uSkyBlur: { value: SKY_BLUR },
      uLowSky: { value: new Vector3(...LOW_SKY) },
      uEarthCourse: { value: EARTH_COURSE },
      uSlab: { value: SLAB },
      uSlabShare: { value: SLAB_SHARE },
      uSlabFalloff: { value: SLAB_FALLOFF },
      uSlabReach: { value: SLAB_REACH },
      uSkyShare: { value: ROCK_SKY_SHARE },
      uPile: { value: piles },
      uCap: { value: caps },
      uPiles: { value: Math.min(ROCK_PILES.length, MAX_PILES) },
      // The light, the sun, the weather in what reflects it and the body of
      // air, all shared by reference: a copy here would be a second answer to
      // where the sun is.
      ...faceLightUniforms(STONE_LIGHT_SCALE * STONE_EXPOSURE),
      ...SCENE_LIGHT_UNIFORMS,
      ...SKY_UNIFORMS,
      ...SKY_REFLECTION,
      ...fogUniforms(),
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: false,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'rocks';
  return {
    meshes: [mesh],
    material,
    quads,
    faces,
    triangles: quads * 2,
    /** The stone tile, once the engine's worker has generated it. */
    setTile(texture) { material.uniforms.tStone.value = texture; },
  };
}

export { pileCensus };
