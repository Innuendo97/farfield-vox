import {
  BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Sphere, Vector3,
} from 'three';
import { SCENE_LIGHT_GLSL, SCENE_LIGHT_UNIFORMS, SKY_GLSL, SKY_UNIFORMS } from '../core/sky.js';
import { FOG_GLSL, fogUniforms } from './air.js';
import { faceLightGlsl, faceLightUniforms } from './face-light.js';
// THE CUT'S OWN ARITHMETIC, WHICH DOES NOT LIVE HERE ANY MORE.
//
// Where a ruin's columns stand, how many courses each carries, where the basin's
// blocks lie: all of it used to be private to this file, and all of it is also
// what a CAMERA has to know, because a box drawn round a ruin from the plan's own
// width and height is 30 mm narrower than the stone in one place and 80 mm
// shorter than it in another. Two readers, so one seat -- and the seat is the
// arithmetic half, src/world/rock-piles.js, which is where the ruins' PLAN
// already lived and which nothing on the page's side of the world imports. It
// is asked for HERE through ./contracts.js, which is the door between the
// sessions and re-exports it: this file used to read the ground and the fountain
// from that door for a ruin's foot and the basin's two radii, and it reads the
// whole law from the same place now.
//
// IT IS THERE AND NOT HERE FOR A SECOND REASON, AND IT IS A HARD ONE. This file
// reaches the page: three.js, the sky, the air, the rocks' own pigment. The
// camera's list is published by src/world/contracts.js, which every measuring
// tool in this campaign imports under plain node -- and contracts.js importing
// THIS file closes a ring (rocks -> rock-piles -> contracts -> loose-stone ->
// rocks) that node cannot evaluate: guard-fiori died on it. The arithmetic half
// imports nothing that comes back round, which is what makes it the seat.
import {
  BASIN_CELL, RUIN_CELL, RUIN_MOSS_SHARE, RUIN_TUFT, RUINS, basinCells, looseHash as hash,
  ruinColumns,
} from './contracts.js';
import { ROCK_ALBEDO } from './rocks.js';
import {
  MOSS_TINT, STONE_ALBEDO, STONE_ARRIS_PIGMENT, STONE_EXPOSURE, STONE_LIGHT_SCALE, STONE_SKY_SHARE,
} from './voxel/masonry.js';

// THE LOOSE STONE: everything in this world that is a cube of stone and is not
// a wall. One mesh, one material, one draw.
//
// WHY THEY ARE ONE THING AND NOT THREE. Three separate answers stand behind
// this file — the turf on the heads of the six, the squared ruins in the grass,
// the basin the fountain stands in — and nothing about them is the same except
// the two facts that decide the architecture: each is a handful of cubes on the
// world's lattice, and each is small. Cut apart they are three geometries,
// three materials and THREE DRAW CALLS on a layer that is allowed nine; cut
// together they are one call for the lot, and the allocation the coordinator
// had to amend is +1 rather than +3 (E-V2i, amended to ten at the pose).
//
// So the seam in this file is between what each family KNOWS — where its cubes
// go and what colour they are — and the one emitter at the bottom that turns
// any of them into faces. A family is a function that pushes cubes; adding a
// fourth costs no call and no material.
//
// AND THE PIGMENT IS NEVER A NEW NUMBER. Every colour below is a product of
// triples that were already fitted, read from the file that fitted them:
//   the turf is STONE_ALBEDO x MOSS_TINT — the wall's own moss, in geometry
//   the ruins are ROCK_ALBEDO — the second stone, as the rocks carry it
//   the moss on a ruin is ROCK_ALBEDO x MOSS_TINT, the same law on the other stone
// A third opinion about what moss looks like is exactly the defect the material
// session spent its first paragraph removing, and it would be reintroduced by a
// file like this one holding its own green.
//
// WHY GEOMETRY AND NOT PAINT, for the turf. The eye stands UNDER every head in
// this hub: the top of the fifth is 4.9 m up and the walker is 1.7 m. A turf
// painted on the lid of a block is a surface nobody in this world can see. What
// the target actually shows is the VERTICAL face of a cube that stands proud of
// the last course, and its silhouette against the sky — and a silhouette is
// something only a triangle has (R5 SS1.6, SS4).

const DEG = Math.PI / 180;

// The cube of this world, and the loose stone is laid on it like everything
// else. Not imported from ./voxel/pure.js on purpose: this file never asks the
// mesher for anything, and the one number it shares with it is a fact about the
// world rather than a dependency on the engine.
const VOXEL = 0.10;

// ------------------------------------------------------------- the pigments
//
// Products, computed once, of triples this file does not own. Written as
// functions of what is imported rather than as literals so that a refit of
// either factor reaches here without anybody remembering to come and look.
const mul = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];

// THE TURF ON THE HEADS. The target's cubes read L* 36, C* 7.4, hue 145 in its
// own frame (R5 SS1.6), and it says outright what they are NOT: the green of
// the meadow, which reads hue 129 at chroma 27.6. They are the moss.
//
// STONE_ALBEDO x MOSS_TINT develops, through the seat and the delivered grade,
// to L* 34.9 on a lid and L* 34.9 against the target's 36 — which is as close
// as a level gets — and to hue 149 on the vertical faces that are the ones the
// eye under a head actually sees. On the lid itself it develops to hue 132 and
// chroma 15.3 against the target's 145 and 7.4, and that miss is declared here
// rather than fitted away: the two factors behind it are the wall's albedo and
// the wall's moss tint, both fitted against readings of their own by the
// material session, and bending either of them to move a lid I am adding would
// be moving the wall to suit its garnish. The chroma half of the miss is also
// the half the air closes: the target's 7.4 is read WITH its haze in it and
// this number is bare, which is the same boundary tools/guards/guard-pietra.mjs
// declares for every level it prints.
export const TURF_ALBEDO = mul(STONE_ALBEDO, MOSS_TINT);

// THE RUINS. The rocks' own stone, at the rocks' own value, because R5 SS7 says
// the ruins are "la stessa pietra della scalinata" and this world already has
// exactly one pale stone in it. Its lit cap develops to L* 54.3 at hue 98
// against the target's 50.5 at 95 (R5 SS1.8), and tools/guards/guard-pietra.mjs
// already holds that triple to 45-58 and 90-115 for the piles.
export const RUIN_ALBEDO = ROCK_ALBEDO;

// AND THE MOSS ON A RUIN, which is the same law on the other stone: 0.55 / 0.80
// / 0.50 of what it grows on, so a moss cube is 0.89 of its block in L* where
// the target reads 0.84 to 0.93 beside the stone next to it.
export const RUIN_MOSS_ALBEDO = mul(ROCK_ALBEDO, MOSS_TINT);

// ------------------------------------------------------------ the turf law
//
// Off the prototype of R5 SS4, and every number in it is a reading of the target
// rather than a taste: candidates along the PERIMETER of the lid because that
// is where the target's cubes stand (an interior cube is invisible from under
// the head anyway), a candidate every 0.20 m, one in six kept, and the corners
// of the lid at nearly twice that because the target puts them there —
// "cubi verde-grigio agli spigoli del coperchio" (R5 SS1.6).
const TURF_STEP = 0.26;
const TURF_SHARE = 0.26;
const TURF_CORNER = 1.8;
const TURF_CORNER_REACH = 0.35;
// AND TWO VOXELS OR THREE, WHICH IS THE READING AND NOT THE PROTOTYPE'S WORD
// FOR IT. R5 SS1.6 says "cubi di 1-2 voxel" and gives the measurement beside it:
// 12 to 18 px on the head of the fifth. The fifth is 67.3 px per metre at the
// fitted pose, so what the target draws is 0.18 to 0.27 m -- two to three of
// this world's voxels, not one to two. Built at one the cubes come out five
// pixels across at twenty-one metres and read as a ragged edge on the lid
// rather than as stones standing on it, which is what the first cut drew.
const TURF_BASE = 2 * VOXEL;
const TURF_WIDE = 0.35;                 // and a third of them are one voxel wider
const TURF_TALL = 0.30;                 // and a third one voxel taller

// ------------------------------------------------------------- the material
//
// The wall's own light, and the wall's own share of the sky. A loose stone is a
// piece of the same stone lying on the same meadow under the same dome, so it
// bends the pair the seat hands it exactly as src/world/voxel/masonry.js does —
// the sky term multiplied by the share, the ground's return taken off what is
// left by construction — and it reads the share from that file rather than
// carrying a second copy of a number that was fitted once.
const VERTEX = /* glsl */`
  attribute vec3 aColour;
  attribute float aUp;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColour;
  varying float vUp;
  varying float vDistance;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vColour = aColour;
    // How far up its OWN cube this corner sits, nought at the foot and one at
    // the lid. It is what the dressed edge below is cut from, and it is carried
    // per vertex rather than rebuilt from the world height because the loose
    // stone is laid at three different block sizes in one mesh: a pitch in the
    // fragment would need a fourth attribute to say WHICH pitch.
    vUp = aUp;
    vDistance = length(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */`
  precision highp float;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColour;
  varying float vUp;
  varying float vDistance;
  uniform float uSkyShare;
  uniform float uArris;
  uniform float uArrisPigment;
  ${SCENE_LIGHT_GLSL}
  ${SKY_GLSL}
  ${faceLightGlsl({ sunDeclared: true })}
  ${FOG_GLSL}
  void main() {
    vec3 n = normalize(vNormal);
    vec2 terms = faceTerms(n);
    terms.y *= uSkyShare;
    vec3 light = faceLightOf(terms);
    vec3 albedo = vColour;

    // ------------------------------------------------- the dressed top edge
    //
    // THE SAME ANSWER src/world/rocks.js GIVES, for the same reason and out of
    // the same constant. The top edge of a cube of this world is not painted
    // paler, it is a facet LEANING UP: so it is handed the light of a facet
    // leaning up, and both how bright it comes out and how blue fall out of that
    // instead of being chosen. Only on the flanks -- a lid has no upper edge to
    // catch -- and it carries the wall's arris pigment, because a broken edge on
    // weathered stone is freshly cut face.
    //
    // WITHOUT IT A LOOSE STONE IS A FLAT DARK GREEN QUAD. A flank of this world
    // that faces the walker faces away from the sun, so what reaches it is the
    // sky term and the meadow's return -- and the meadow's return is green by
    // construction (BOUNCE_GROUND). The rocks beside these stones are saved from
    // it by their own arris; a stone cut without one reads as a hole in the
    // grass, which is what the first cut of this file drew.
    //
    // AND THE BAND IS A FRACTION OF THE CUBE AND NOT A COUNT OF PIXELS, which is
    // where this parts company with rocks.js. That file measures its band in
    // screen pixels because its pitch is one number for every pile; here three
    // block sizes share one program, so a band in pixels would be a different
    // fraction of a 0.10 m turf cube and of a 0.35 m ruin block. A fraction
    // shrinks with the cube on its own and cannot shimmer at range.
    float flank = 1.0 - abs(n.y);
    float arris = smoothstep(1.0 - uArris, 1.0, vUp) * flank;
    if (arris > 0.0) {
      vec3 leaning = normalize(n + vec3(0.0, 1.0, 0.0));
      vec2 up = faceTerms(leaning);
      up.y *= uSkyShare;
      light = mix(light, faceLightOf(up), arris);
      albedo *= mix(1.0, uArrisPigment, arris);
    }

    vec3 colour = albedo * light;
    colour = throughAir(colour, vDistance, vWorld.y);
    gl_FragColor = vec4(colour, 1.0);
  }
`;

// How much of a cube's flank the dressed edge takes. The wall cuts its chamfer
// as geometry on a 0.19 m course and it comes to about a sixth of the face at
// this range; a loose stone cannot afford the triangles for a real chamfer, so
// this is the share the shading stands in over.
const ARRIS_BAND = 0.12;

/**
 * One cube, as five faces: everything but the bottom.
 *
 * THE BOTTOM IS NEVER CUT, and it is worth saying why that is safe here where
 * it would not be in the mesher. Every cube this file emits stands ON something
 * — the lid of a block, the meadow, the course under it — so its underside is
 * against another surface and no eye in this world reaches it. Five faces
 * instead of six is a fifth of the triangles of a mesh whose whole argument is
 * that it is small.
 */
function cube(out, cx, cy, cz, sx, sy, sz, colour, angle = 0) {
  const c = Math.cos(angle); const s = Math.sin(angle);
  // A TINT PER FACE AND NOT PER CUBE, which is the cheapest grain there is and
  // the one thing that keeps a stack of loose stone from reading as a few large
  // flat plates. The walls and the piles of this world get their grain from the
  // shared stone tile; a mesh of two hundred cubes cannot afford a sampler and
  // a set of texture coordinates for it, and it does not need one -- at this
  // size a whole face is about the area of one texel of that tile anyway, so
  // one value per face IS the tile at this scale.
  const grain = (k) => 0.92 + 0.16 * hash(Math.round(cx * 97), Math.round(cz * 89 + cy * 53), k);
  const turn = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
  const FACES = [
    { n: [0, 1, 0], q: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
    { n: [1, 0, 0], q: [[1, 0, 1], [1, 1, 1], [1, 1, -1], [1, 0, -1]] },
    { n: [-1, 0, 0], q: [[-1, 0, -1], [-1, 1, -1], [-1, 1, 1], [-1, 0, 1]] },
    { n: [0, 0, 1], q: [[-1, 0, 1], [-1, 1, 1], [1, 1, 1], [1, 0, 1]] },
    { n: [0, 0, -1], q: [[1, 0, -1], [1, 1, -1], [-1, 1, -1], [-1, 0, -1]] },
  ];
  for (let fi = 0; fi < FACES.length; fi++) {
    const f = FACES[fi];
    const base = out.positions.length / 3;
    const nx = f.n[0] * c + f.n[2] * s;
    const nz = -f.n[0] * s + f.n[2] * c;
    const g = grain(fi);
    for (const [qx, qy, qz] of f.q) {
      const [wx, wz] = turn(qx * sx / 2, qz * sz / 2);
      out.positions.push(wx, cy + qy * sy, wz);
      out.normals.push(nx, f.n[1], nz);
      out.colours.push(colour[0] * g, colour[1] * g, colour[2] * g);
      out.ups.push(qy);
    }
    out.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  out.cubes += 1;
}

/**
 * The turf on the head of one block.
 *
 * The lid is not flat — a head is built of runs of different course counts, and
 * `masonry.head` is the law of it — so the height a cube stands at is asked of
 * the run it lands over rather than of the block. A cube dropped at the block's
 * own height would float over the low end of every stepped head in the hub.
 */
function turfOn(out, spec) {
  const m = spec.masonry;
  if (!m || !m.head) return;
  const w = spec.size[0]; const d = spec.size[2];
  const angle = spec.rotationY * DEG;
  const seed = Number(spec.id) || 7;
  const topAt = (x) => {
    const frac = (x + w / 2) / w;
    let courses = m.head[m.head.length - 1].courses;
    for (const run of m.head) { if (frac <= run.to) { courses = run.courses; break; } }
    return spec.baseY + courses * m.rise;
  };

  const edges = [];
  for (let x = -w / 2 + 0.1; x < w / 2 - 0.05; x += TURF_STEP) {
    edges.push([x, d / 2 - 0.1]); edges.push([x, -d / 2 + 0.1]);
  }
  for (let z = -d / 2 + 0.3; z < d / 2 - 0.25; z += TURF_STEP) {
    edges.push([w / 2 - 0.1, z]); edges.push([-w / 2 + 0.1, z]);
  }

  let i = 0;
  let placed = 0;
  for (const [lx, lz] of edges) {
    i += 1;
    const corner = Math.min(Math.abs(Math.abs(lx) - w / 2), Math.abs(Math.abs(lz) - d / 2))
      < TURF_CORNER_REACH ? TURF_CORNER : 1;
    if (hash(seed, i, 1) > TURF_SHARE * corner) continue;
    const sx = TURF_BASE + (hash(seed, i, 2) < TURF_WIDE ? VOXEL : 0);
    const sy = TURF_BASE + (hash(seed, i, 3) < TURF_TALL ? VOXEL : 0);
    // Held inside the lid, flush with its edge: a cube hanging over the rim
    // would show its underside to the walker, which is the one face not cut.
    const px = Math.max(-w / 2 + sx / 2, Math.min(w / 2 - sx / 2, lx));
    const pz = Math.max(-d / 2 + sx / 2, Math.min(d / 2 - sx / 2, lz));
    const [wx, wz] = [
      spec.position.x + px * Math.cos(angle) + pz * Math.sin(angle),
      spec.position.z - px * Math.sin(angle) + pz * Math.cos(angle),
    ];
    // A tint per cube, on the same 0.80 to 1.20 the prototype carried, so a run
    // of turf is not one flat green.
    const t = 0.80 + 0.40 * hash(seed, i, 4);
    cube(out, wx, topAt(px), wz, sx, sy, sx,
      [TURF_ALBEDO[0] * t, TURF_ALBEDO[1] * t, TURF_ALBEDO[2] * t], angle);
    placed += 1;
  }
  return placed;
}

/** One ruin: a stepped stack of dressed cubes, quantised to whole courses. */
function ruin(out, plan) {
  const { foot, columns } = ruinColumns(plan);
  for (const { i, k, courses, x: cx, z: cz } of columns) {
    for (let j = 0; j < courses; j++) {
      const t = 0.86 + 0.28 * hash(plan.seed, i * 31 + k, 9 + j);
      cube(out, cx, foot + j * RUIN_CELL, cz, RUIN_CELL, RUIN_CELL, RUIN_CELL,
        [RUIN_ALBEDO[0] * t, RUIN_ALBEDO[1] * t, RUIN_ALBEDO[2] * t]);
    }
    // And the tuft on the lid this column ends at, set back from the middle so
    // it sits over an EDGE of the block the way the target's do.
    if (courses > 0 && hash(plan.seed, i * 31 + k, 3) < RUIN_MOSS_SHARE) {
      const g = 0.86 + 0.28 * hash(plan.seed, i * 31 + k, 7);
      const off = (RUIN_CELL - RUIN_TUFT) / 2;
      cube(out,
        cx + off * (hash(plan.seed, i * 31 + k, 11) < 0.5 ? -1 : 1),
        foot + courses * RUIN_CELL,
        cz + off * (hash(plan.seed, i * 31 + k, 13) < 0.5 ? -1 : 1),
        RUIN_TUFT, RUIN_TUFT, RUIN_TUFT,
        [RUIN_MOSS_ALBEDO[0] * g, RUIN_MOSS_ALBEDO[1] * g, RUIN_MOSS_ALBEDO[2] * g]);
    }
  }
}

/** The ring of pale stone the fountain of the fifth stands in. */
function basin(out) {
  const ring = basinCells();
  if (!ring) return 0;
  let placed = 0;
  for (const cell of ring.cells) {
    for (let j = 0; j < cell.courses; j++) {
      const t = 0.88 + 0.24 * hash(97, cell.i * 31 + cell.k, j);
      cube(out, cell.x, ring.foot + j * BASIN_CELL, cell.z,
        BASIN_CELL, BASIN_CELL, BASIN_CELL,
        [RUIN_ALBEDO[0] * t, RUIN_ALBEDO[1] * t, RUIN_ALBEDO[2] * t]);
    }
    placed += 1;
  }
  return placed;
}

/**
 * Every loose stone in this world, as one mesh.
 *
 * @param {object[]} specs  the blocks, as src/world/stone.js cuts them
 */
export function createLooseStone(specs) {
  const out = {
    positions: [], normals: [], colours: [], ups: [], indices: [], cubes: 0,
  };
  const counts = { turf: 0, ruins: 0, basin: 0 };
  for (const spec of specs) counts.turf += turfOn(out, spec) || 0;
  const beforeRuins = out.cubes;
  for (const plan of RUINS) ruin(out, plan);
  counts.ruins = out.cubes - beforeRuins;
  const beforeBasin = out.cubes;
  basin(out);
  counts.basin = out.cubes - beforeBasin;

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(out.positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(out.normals), 3));
  geometry.setAttribute('aColour', new BufferAttribute(new Float32Array(out.colours), 3));
  geometry.setAttribute('aUp', new BufferAttribute(new Float32Array(out.ups), 1));
  geometry.setIndex(new BufferAttribute(new Uint16Array(out.indices), 1));
  // A TRUE BOUND, computed from the positions, because unlike the markers these
  // cubes stand where their vertices say they do. It is what lets this mesh be
  // culled the moment the hub leaves the frame instead of being submitted from
  // every pose in the world.
  geometry.computeBoundingSphere();
  if (!geometry.boundingSphere) geometry.boundingSphere = new Sphere(new Vector3(), 1);

  const material = new ShaderMaterial({
    uniforms: {
      uSkyShare: { value: STONE_SKY_SHARE },
      uArris: { value: ARRIS_BAND },
      uArrisPigment: { value: STONE_ARRIS_PIGMENT },
      ...faceLightUniforms(STONE_LIGHT_SCALE * STONE_EXPOSURE),
      ...SCENE_LIGHT_UNIFORMS,
      ...SKY_UNIFORMS,
      ...fogUniforms(),
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: false,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'loose-stone';
  return {
    mesh, material, counts, cubes: out.cubes, triangles: out.indices.length / 3,
  };
}
