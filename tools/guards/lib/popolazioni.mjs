// EVERY POPULATION OF THIS WORLD THAT IS WRITTEN AS TRIANGLES, IN ONE LIST.
//
// The list lives here and not in the bench or in the guard because the bench and
// the guard ask the same question of the same objects and would otherwise hold
// two copies of it. Two copies of a decision is how a census comes to measure
// one world and a gate to guard another.
//
// EACH ENTRY BUILDS. It does not describe: it calls what the world calls and
// hands back the buffer that came out, so a population cannot pass the gate by
// being written about correctly. Where a builder needs an asset the bench has no
// browser to fetch, a stand-in stands in its place and the entry says so -- the
// geometry and the material are still the real ones, because on this world
// neither is decided by a texel.
//
// A POPULATION THAT IS NOT ON THE BRANCH IS NOT A FAILURE. Eight sessions carry
// eight halves of this world and the foundation branch has never had the avatar
// on it. An entry that cannot load says so and is counted as unmeasured, which
// is the one thing it must never be confused with: measured and sound.

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

/** three's side enum as the word the report prints. */
export const SIDE = ['FrontSide', 'BackSide', 'DoubleSide'];

/** three's blending enum, far enough to name the one that matters. */
const ADDITIVE = 2;

export const sideOf = (material) => {
  if (!material) return 'no material';
  const m = Array.isArray(material) ? material[0] : material;
  return SIDE[m.side] ?? `side=${m.side}`;
};

/** A mesh three built, as the plain arrays the bench reads. */
export function fromMesh(mesh) {
  const g = mesh.geometry;
  return {
    positions: g.attributes.position.array,
    normals: g.attributes.normal ? g.attributes.normal.array : null,
    indices: g.index ? g.index.array : null,
  };
}

/**
 * The populations, each as a function that builds and hands back what it built.
 *
 * @param {string} root the worktree to read
 * @returns {{name:string, owner:string, build:() => Promise<object[]>}[]}
 */
export function populations(root) {
  const load = (rel) => import(pathToFileURL(join(root, rel)).href);
  const json = (rel) => import(pathToFileURL(join(root, rel)).href,
    { with: { type: 'json' } }).then((m) => m.default);

  return [
    {
      // DUE ORA, E SONO DUE GEOMETRIE. E-DECISIONI15 da' ai due fiori due lampade
      // diverse -- una al centro del bianco, quattro agli angoli del blu -- e il
      // ramo le disegna con due mesh invece di far pagare a ogni pianta tutte e
      // due. Il guscio e' a PANNELLI su due facce: l'avvolgimento non decide piu'
      // se una faccia si disegna, decide come e' illuminata, e la chiusura del
      // bocciolo la misura guard-fiori con i propri raggi.
      name: 'fiori', owner: 'V4', closed: true,
      where: 'vegetation.js flowerCensus / il materiale del fiore vicino',
      async build() {
        const veg = await load('src/world/vegetation.js');
        const faces = veg.flowerCensus().faces;
        return ['bianco', 'ciano'].map((kind) => ({
          suffix: kind, mesh: { faces: faces[kind] }, side: 'DoubleSide',
        }));
      },
    },
    {
      name: 'alberi', owner: 'V4', closed: true, grid: 56,
      where: 'trees.js mergeFaces (u,v per asse) / geometryOf',
      async build() {
        const trees = await load('src/world/trees.js');
        const built = trees.createTrees({ height: () => 0 });
        return built.meshes.map((mesh, i) => ({
          suffix: i === 0 ? 'chiome e tronchi' : 'secondo pigmento',
          mesh: fromMesh(mesh), material: mesh.material, side: sideOf(mesh.material),
        }));
      },
    },
    {
      name: 'erba e fiori lontani', owner: 'V4', grid: 48,
      where: 'vegetation.js cardGeometry / farGeometry',
      async build() {
        const veg = await load('src/world/vegetation.js');
        const built = veg.createVegetation({ grassAtlas: null, height: () => 0, lightScale: 1 });
        return built.meshes.map((mesh, i) => ({
          suffix: `mesh ${i}`, mesh: fromMesh(mesh),
          material: mesh.material, side: sideOf(mesh.material),
        }));
      },
    },
    {
      name: 'muratura', owner: 'V2', grid: 56,
      where: 'voxel/courses.js quad + la tavola skin delle normali',
      async build() {
        const courses = await load('src/world/voxel/courses.js');
        const stone = await load('src/world/stone.js');
        const spec = await json('assets-src/monoliths/masonry-spec.json');
        const pieces = [...stone.stoneSpecs(spec), ...stone.stairSpecs(spec)];
        return pieces.map((piece) => ({
          suffix: piece.id, mesh: courses.buildMasonry(piece), side: 'FrontSide',
        }));
      },
    },
    {
      name: 'rocce', owner: 'V2', closed: true, grid: 56,
      where: 'rock-piles.js meshPile (le quad girano col segno della faccia)',
      async build() {
        // contracts.js first: rock-piles and rocks close a circle through it and
        // the loader trips over it if the circle is entered from the wrong side.
        await load('src/world/contracts.js');
        const piles = await load('src/world/rock-piles.js');
        return (piles.ROCK_PILES || []).map((rock, i) => ({
          suffix: String(rock.id ?? i), mesh: piles.meshPile(rock), side: 'FrontSide',
        }));
      },
    },
    {
      name: 'scalinata', owner: 'V2', grid: 48,
      where: 'stairs.js stairMesh: indici (0,2,1)(0,3,2) e nessuna normale',
      async build() {
        const stairs = await load('src/world/stairs.js');
        const built = stairs.stairMesh();
        return [{
          mesh: { positions: built.positions, indices: built.indices, normals: null },
          side: 'no material',
        }];
      },
    },
    {
      name: 'marcatori a rombo', owner: 'V2',
      where: 'monoliths.js markersGeometry / il materiale additivo dei marcatori',
      async build() {
        const mon = await load('src/world/monoliths.js');
        const built = mon.createMonoliths();
        return built.meshes.map((mesh, i) => ({
          suffix: String(i), mesh: fromMesh(mesh),
          material: mesh.material, side: sideOf(mesh.material), billboard: true,
        }));
      },
    },
    {
      name: 'cornice lontana', owner: 'V5', grid: 56,
      where: 'distant.js buildRing / buildFloor / buildGiants / il foglio del lago',
      async build() {
        const distant = await load('src/world/distant.js');
        const built = distant.createDistance();
        return built.meshes.map((mesh, i) => ({
          suffix: `mesh ${i}${mesh.isInstancedMesh ? ' (istanziata)' : ''}`,
          mesh: fromMesh(mesh), material: mesh.material, side: sideOf(mesh.material),
        }));
      },
    },
    {
      name: 'avatar', owner: 'V8', closed: true, grid: 56,
      where: 'avatar/mesher.js: gli indici girano col verso della faccia',
      async build() {
        const mesher = await load('src/world/avatar/mesher.js');
        const plan = await load('src/world/avatar/plan.js');
        const bodies = plan.BODIES || { m: plan.BODY_M };
        return Object.entries(bodies).map(([kind, body]) => {
          const built = mesher.build(0.10 / 4, body);
          return {
            suffix: `corpo ${kind.toUpperCase()}`,
            mesh: {
              positions: built.positions, normals: built.normals, indices: built.indices,
            },
            side: 'FrontSide',
          };
        });
      },
    },
    // IL GUSCIO NON E' PIU' UNA POPOLAZIONE. Era un disegno solo, 7.168
    // triangoli dall'orlo del disco ai cento metri, e resta la storia migliore
    // di questo censimento: i suoi due triangoli per quad erano avvolti in
    // senso orario visti dall'alto, il materiale e' FrontSide, e per un'intera
    // campagna non ne e' stato disegnato nemmeno uno. E-DECISIONI13 lo ha
    // ritirato -- oltre l'altopiano il terreno e' COLONNE e lo disegna il campo
    // ray-marchato -- e un raggio non ha un avvolgimento da sbagliare. Qui non
    // resta niente da contare.
    {
      name: 'manto, cumuli, tasselli', owner: 'FOND', grid: 40, rays: 'sample',
      where: 'voxel/mesher.js QUAD_INDEX e le quaterne di spigoli per faccia',
      async build() {
        const pure = await load('src/world/voxel/pure.js');
        const list = pure.chunkList();
        const out = [];
        for (const [i, { cx, cz }] of list.entries()) {
          const chunk = pure.meshChunk(cx, cz);
          for (const [part, label] of [[chunk, 'manto'], [chunk.earth, 'terra'],
            [chunk.paving, 'tasselli'], [chunk.mat, 'fili']]) {
            if (!part || !part.positions || !part.positions.length) continue;
            out.push({
              suffix: `${label} chunk ${cx},${cz}`, family: label, index: i,
              mesh: {
                positions: part.positions, normals: part.normals, indices: part.indices,
              },
              side: 'FrontSide',
            });
          }
        }
        return out;
      },
    },
    {
      name: 'nuvole', owner: 'V6', grid: 48, billboard: true,
      where: 'clouds.js: le quad e il side del materiale',
      async build() {
        const clouds = await load('src/world/clouds.js');
        // The atlas is a download and there is no browser here, but the FIELD is
        // arithmetic: placements, quads and material are all decided before a
        // texel is read, so a stand-in changes none of the three counts.
        const built = clouds.createClouds({
          clouds: { isTexture: true, image: { width: 1, height: 1 } },
        });
        return built.meshes.map((mesh, i) => ({
          suffix: String(i), mesh: fromMesh(mesh),
          material: mesh.material, side: sideOf(mesh.material), billboard: true,
        }));
      },
    },
  ];
}

/** Whether a live material blends additively, asked of the object and not of the text. */
export const isAdditive = (material) => {
  if (!material) return false;
  const m = Array.isArray(material) ? material[0] : material;
  return m.blending === ADDITIVE;
};

/** Whether a live material draws a surface seen from either side. */
export const drawsFromEitherSide = (material) => {
  if (!material) return false;
  const m = Array.isArray(material) ? material[0] : material;
  return m.side === 2;
};
