// EVERY POPULATION THE WORLD BUILDS, READ FOR WINDING AND FOR HOLES.
//
//   node tools/bench/censo-avvolgimento.mjs [--root=<worktree>] [--grid=N] [--json=<file>]
//
// The root defaults to this worktree. It is a flag because the branch that owns
// the guards is not the branch that carries the whole world: the census that
// matters is taken over ALL of it, and a bench that could only read its own
// checkout would report the populations it happens to have and call the rest
// absent.
//
// THE MEASUREMENT IS TAKEN ON WHAT THE WORLD ACTUALLY BUILDS. Where a builder
// runs outside a browser -- and almost all of them do, because three itself
// needs no context until a renderer is made -- the bench calls it and reads the
// buffer it produced. It does not re-derive the geometry from the source, and it
// does not re-derive the material's side from the text: it asks the object. That
// is the difference between this and a grep, and it is the reason the two holes
// declared against guard-additiva (E-V7g: a blending written as a constant, a
// side assigned after the construction) cannot exist here.

import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { HEADER, census, line } from '../guards/lib/avvolgimento.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const ROOT = resolve(flag('root', resolve(new URL('../..', import.meta.url).pathname.slice(1))));
const GRID = Number(flag('grid', 72));
const JSON_OUT = flag('json', '');

const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

/** three's side enum, as the word the report prints. */
const SIDE = ['FrontSide', 'BackSide', 'DoubleSide'];
const sideOf = (material) => {
  if (!material) return 'no material';
  const m = Array.isArray(material) ? material[0] : material;
  return SIDE[m.side] ?? `side=${m.side}`;
};

/** A mesh three built, as the plain arrays the bench reads. */
function fromMesh(mesh) {
  const g = mesh.geometry;
  return {
    positions: g.attributes.position.array,
    normals: g.attributes.normal ? g.attributes.normal.array : null,
    indices: g.index ? g.index.array : null,
  };
}

const rows = [];
const notes = [];
const missing = [];

/**
 * One population measured, or one declared reason it could not be.
 *
 * A population the bench could not reach is reported as UNREACHED and never as
 * zero: a zero nobody measured is exactly the number that let seven thousand
 * triangles ship as sky.
 */
async function take(name, owner, produce) {
  try {
    const got = await produce();
    if (!got) { missing.push({ name, owner, why: 'builder returned nothing' }); return; }
    const list = Array.isArray(got) ? got : [got];
    for (const item of list) {
      const side = item.side ?? 'no material';
      const result = census(item.name || name, item.mesh, {
        closed: item.closed ?? false,
        rays: item.rays === false ? false
          : { grid: item.grid ?? GRID, side: sideKind(side) },
      });
      result.owner = owner;
      result.side = side;
      result.where = item.where || '';
      rows.push(result);
    }
  } catch (error) {
    missing.push({ name, owner, why: String(error.message).slice(0, 150) });
  }
}

const sideKind = (side) => (side === 'DoubleSide' ? 'double'
  : side === 'BackSide' ? 'back' : 'front');

// ---------------------------------------------------------------- V4, the green

await take('fiori (solido)', 'V4', async () => {
  const veg = await load('src/world/vegetation.js');
  const faces = veg.flowerCensus().faces;
  return {
    mesh: { faces },
    closed: true,
    side: 'FrontSide',
    where: 'vegetation.js:1590 flowerCensus / :2517 material',
  };
});

await take('alberi', 'V4', async () => {
  const trees = await load('src/world/trees.js');
  const built = trees.createTrees({ height: () => 0 });
  return built.meshes.map((mesh, i) => ({
    name: `alberi ${i === 0 ? 'chiome+tronchi' : 'secondo pigmento'}`,
    mesh: fromMesh(mesh),
    side: sideOf(mesh.material),
    closed: true,
    grid: 56,
    where: 'trees.js:344 geometryOf / :311 mergeFaces',
  }));
});

await take('erba (card) + fiori lontani', 'V4', async () => {
  const veg = await load('src/world/vegetation.js');
  const built = veg.createVegetation({ grassAtlas: null, height: () => 0, lightScale: 1 });
  return built.meshes.map((mesh, i) => ({
    name: `vegetazione mesh ${i}`,
    mesh: fromMesh(mesh),
    side: sideOf(mesh.material),
    where: 'vegetation.js:609 cardGeometry / :2121 farGeometry',
  }));
});

// ---------------------------------------------------------------- V2, the stone

await take('muratura', 'V2', async () => {
  const courses = await load('src/world/voxel/courses.js');
  const stone = await load('src/world/stone.js');
  // The specs the layer actually ships, and not the plan they are cut from:
  // a bench that re-derived them would be measuring its own arithmetic.
  const spec = (await import(pathToFileURL(
    join(ROOT, 'assets-src/monoliths/masonry-spec.json')).href,
  { with: { type: 'json' } })).default;
  const pieces = [...stone.stoneSpecs(spec), ...stone.stairSpecs(spec)];
  return pieces.map((piece) => ({
    name: `muratura ${piece.id}`,
    mesh: courses.buildMasonry(piece),
    side: 'FrontSide',
    grid: 56,
    where: 'courses.js:392 quad / masonry.js:864 material',
  }));
});

await take('rocce (pile)', 'V2', async () => {
  await load('src/world/contracts.js');
  const piles = await load('src/world/rock-piles.js');
  const list = piles.ROCK_PILES || [];
  return list.map((rock, i) => ({
    name: `pila ${rock.id || i}`,
    mesh: piles.meshPile(rock),
    side: 'FrontSide',
    closed: true,
    grid: 56,
    where: 'rock-piles.js:406 quad / rocks.js:442 material',
  }));
});

await take('scalinata (facce)', 'V2', async () => {
  const stairs = await load('src/world/stairs.js');
  const mesh = stairs.stairMesh();
  return {
    mesh: { positions: mesh.positions, indices: mesh.indices, normals: null },
    side: 'no material',
    where: 'stairs.js:266 index / :130 stairFaces',
  };
});

await take('marcatori a rombo', 'V2', async () => {
  const mon = await load('src/world/monoliths.js');
  const built = mon.createMonoliths();
  return built.meshes.map((mesh, i) => ({
    name: `marcatori ${i}`,
    mesh: fromMesh(mesh),
    side: sideOf(mesh.material),
    where: 'monoliths.js:180 position / :188 index / :325 side',
  }));
});

await take('pannelli', 'V2', async () => {
  // The panel is a THREE PlaneGeometry and not a hand-written quad, so what the
  // bench can say about it is that the primitive is sound and that the material
  // is single sided. Both are measured rather than assumed: the primitive is put
  // through the same three counts as everything else.
  const three = await import('three');
  const g = new three.PlaneGeometry(1, 1);
  return {
    name: 'pannelli (PlaneGeometry)',
    mesh: {
      positions: g.attributes.position.array,
      normals: g.attributes.normal.array,
      indices: g.index.array,
    },
    side: 'FrontSide',
    where: 'panels.js:179 PlaneGeometry / :488 material (side assente)',
  };
});

// ---------------------------------------------------------------- V5, the frame

await take('cornice lontana', 'V5', async () => {
  const distant = await load('src/world/distant.js');
  const built = distant.createDistance();
  // The meshes are named from what they ARE and not from the order they come
  // back in: an order is a thing that changes under somebody else's edit, and a
  // census whose labels slid by one would be worse than no census.
  const label = (mesh) => {
    const g = mesh.geometry;
    const box = g.boundingSphere ? g.boundingSphere.radius : 0;
    if (mesh.isInstancedMesh) return box > 0.8 ? 'giganti lontani' : 'alberi lontani';
    return g.attributes.position.count > 1000 ? 'creste e terrazze' : 'lago';
  };
  return built.meshes.map((mesh) => ({
    name: label(mesh),
    mesh: fromMesh(mesh),
    side: sideOf(mesh.material),
    grid: 56,
    where: 'distant.js:846 buildRing / :917 buildFloor / :1354 giganti / :1571 lago',
  }));
});

// ---------------------------------------------------------------- V8, the avatar

await take('avatar', 'V8', async () => {
  const mesher = await load('src/world/avatar/mesher.js');
  const plan = await load('src/world/avatar/plan.js');
  const cell = 0.10 / 4;
  return Object.entries(plan.BODIES || { m: plan.BODY_M }).map(([kind, body]) => {
    const built = mesher.build(cell, body);
    return {
      name: `avatar corpo ${kind.toUpperCase()}`,
      mesh: { positions: built.positions, normals: built.normals, indices: built.indices },
      side: 'FrontSide',
      closed: true,
      grid: 56,
      where: 'avatar/mesher.js:203 index / avatar/material.js:382 material',
    };
  });
});

// ------------------------------------------------------- the foundation, mine

await take('guscio (oltre il disco)', 'FOND', async () => {
  const shell = await load('src/world/ground-shell.js');
  const built = shell.createGroundShell({ radius: 35, material: null });
  const mesh = built.mesh || built.meshes[0];
  return {
    mesh: fromMesh(mesh),
    side: 'FrontSide',
    grid: 56,
    where: 'ground-shell.js:179 index',
  };
});

await take('manto, cumuli e tasselli', 'FOND', async () => {
  const pure = await load('src/world/voxel/pure.js');
  const list = pure.chunkList();
  // EVERY chunk is read for winding, because that count is linear and a sample
  // could miss the one plane a mesher gets wrong. The ray sheets are the
  // expensive leg, so they run on a spread of eight -- the rays cannot say
  // anything the winding does not already say once a normal is declared, and
  // here one is.
  const RAYED = new Set([0, 1, 2, 3, 4, 5, 6, 7].map(
    (k) => Math.floor((k * list.length) / 8)));
  const out = [];
  for (const [i, { cx, cz }] of list.entries()) {
    const chunk = pure.meshChunk(cx, cz);
    for (const [part, label] of [[chunk, 'manto'], [chunk.earth, 'terra'],
      [chunk.paving, 'tasselli'], [chunk.mat, 'fili']]) {
      if (!part || !part.positions || !part.positions.length) continue;
      out.push({
        name: `${label} chunk ${cx},${cz}`,
        mesh: { positions: part.positions, normals: part.normals, indices: part.indices },
        side: 'FrontSide',
        grid: 40,
        rays: RAYED.has(i) ? undefined : false,
        where: 'mesher.js:281 top / :399 walls / :117 QUAD_INDEX',
      });
    }
  }
  return out;
});

// ---------------------------------------------------------------- V6, the sky

await take('nuvole', 'V6', async () => {
  const clouds = await load('src/world/clouds.js');
  // The atlas is a download and this bench has no browser to fetch it in, but
  // the FIELD is arithmetic: the placements, the quads and the material are all
  // decided without a texel being read. A stand-in stands where the atlas would,
  // so what comes back is the geometry the world builds and the material it
  // declares -- and the side is read off the object, not off the source.
  const built = clouds.createClouds({ clouds: { isTexture: true, image: { width: 1, height: 1 } } });
  return built.meshes.map((mesh, i) => ({
    name: `nuvole ${i}`,
    mesh: fromMesh(mesh),
    side: sideOf(mesh.material),
    grid: 48,
    where: 'clouds.js:1155 corners / :1202 index / :1307 side',
  }));
});

// ---------------------------------------------------------------- the report

/**
 * The disc is hundreds of chunks of one mesher, and hundreds of lines of the
 * same answer is not a report. They are summed into one row per family -- and a
 * chunk with anything wrong in it is printed on its own besides, so the sum can
 * never swallow the one plane that is broken.
 */
function fold(list) {
  const out = [];
  const pots = new Map();
  for (const row of list) {
    const family = /^(manto|terra|tasselli|fili) chunk /.exec(row.name);
    if (!family) { out.push(row); continue; }
    const key = family[1];
    let pot = pots.get(key);
    if (!pot) {
      pot = {
        name: `${key} (tutti i chunk)`, owner: row.owner, side: row.side, where: row.where,
        closed: false, chunks: 0, rayed: 0,
        winding: { faces: 0, reversed: 0, degenerate: 0, undeclared: 0, samples: [] },
        shell: { faces: 0, boundary: 0, inconsistent: 0, nonManifold: 0, volume: 0 },
        rays: {
          struck: 0, holes: 0, holesFlipped: 0, holesOpen: 0, holesUndeclared: 0,
          worst: { holes: 0, bearing: 0, elevation: 0 },
        },
      };
      pots.set(key, pot);
      out.push(pot);
    }
    pot.chunks++;
    for (const k of ['faces', 'reversed', 'degenerate', 'undeclared']) {
      pot.winding[k] += row.winding[k];
    }
    for (const k of ['faces', 'boundary', 'inconsistent', 'nonManifold', 'volume']) {
      pot.shell[k] += row.shell[k];
    }
    if (row.rays) {
      pot.rayed++;
      for (const k of ['struck', 'holes', 'holesFlipped', 'holesOpen', 'holesUndeclared']) {
        pot.rays[k] += row.rays[k];
      }
      if (row.rays.worst.holes > pot.rays.worst.holes) pot.rays.worst = row.rays.worst;
    }
    if (row.winding.reversed || row.shell.inconsistent
      || (row.rays && row.rays.holesFlipped)) out.push(row);
  }
  return out;
}

const folded = fold(rows);


process.stdout.write('CENSO DEGLI AVVOLGIMENTI E DEI BUCHI\n');
process.stdout.write(`root ${ROOT}\n\n`);
process.stdout.write(`${HEADER}  ${'side'.padStart(11)}  owner\n`);
let reversed = 0;
let holes = 0;
for (const row of folded) {
  process.stdout.write(`${line(row)}  ${String(row.side).padStart(11)}  ${row.owner}\n`);
  reversed += row.winding.reversed;
  holes += row.rays ? row.rays.holesFlipped : 0;
}
process.stdout.write(`\n${rows.length} popolazioni misurate`
  + `  facce al contrario ${reversed}  raggi in un buco ${holes}\n`);

if (missing.length) {
  process.stdout.write('\nNON RAGGIUNTE (dichiarate, mai contate come zero):\n');
  for (const m of missing) process.stdout.write(`  ${m.owner} ${m.name}: ${m.why}\n`);
}
for (const n of notes) process.stdout.write(`NOTE  ${n}\n`);

const worst = folded.filter((r) => r.winding.reversed || r.shell.inconsistent
  || (r.rays && (r.rays.holesFlipped || r.rays.holesUndeclared)));
if (worst.length) {
  process.stdout.write('\nI SOSPETTI, IN DETTAGLIO:\n');
  for (const r of worst) {
    process.stdout.write(`  ${r.name} (${r.owner}, ${r.side}) ${r.where}\n`);
    process.stdout.write(`    facce ${r.winding.faces}  al contrario ${r.winding.reversed}`
      + `  spigoli aperti ${r.shell.boundary}  spigoli in conflitto ${r.shell.inconsistent}`
      + `  volume ${r.shell.volume.toFixed(4)}\n`);
    if (r.rays) {
      process.stdout.write(`    raggi ${r.rays.struck} sulla sagoma, ${r.rays.holes} in un buco`
        + `  (peggiore ${r.rays.worst.holes} al rilevamento ${r.rays.worst.bearing}`
        + ` a ${r.rays.worst.elevation} gradi)\n`);
    }
  }
}

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ root: ROOT, rows, missing, notes }, null, 1));
  process.stdout.write(`\nscritto ${JSON_OUT}\n`);
}
