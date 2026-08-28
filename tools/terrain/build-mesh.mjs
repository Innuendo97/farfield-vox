import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../grade/lib/framing.mjs';
import { writeCleanPng } from '../grade/lib/png.mjs';
import { MONOLITHS, PLATFORM, STAIRS } from '../../src/world/layout.js';
import { ATLAS, stairMesh } from '../../src/world/stairs.js';
import {
  GRID, gridToOffset, heightAt, pathCentreX,
} from '../../src/world/terrain-field.js';

// Builds the ground mesh and hands it to Blender as plain floats.
//
// The vertices are computed here rather than in the bake script on purpose.
// The field is defined once, in JavaScript, and the runtime walks on it; if
// Blender rebuilt the same surface from its own copy of the arithmetic the two
// would drift apart the first time either was touched, and the drift would show
// up as the player sinking into a hill. So Python is given the finished
// positions and never has an opinion about where the ground is.

const OUT_DIR = join(REPO_ROOT, 'assets-src', 'terrain');

function build() {
  const n = GRID.samples;
  const positions = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);

  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < n; j++) {
    const v = j / (n - 1);
    const z = GRID.centreZ + gridToOffset(v * 2 - 1);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const x = GRID.centreX + gridToOffset(u * 2 - 1);
      const y = heightAt(x, z);
      const o = (j * n + i) * 3;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = z;
      const t = (j * n + i) * 2;
      uvs[t] = u;
      uvs[t + 1] = v;
      if (y < min) min = y;
      if (y > max) max = y;
    }
  }
  return { positions, uvs, n, min, max };
}

async function preview({ positions, n, min, max }) {
  const pixels = Buffer.alloc(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const y = positions[(j * n + i) * 3 + 1];
      const t = (y - min) / (max - min || 1);
      const o = (j * n + i) * 3;
      pixels[o] = Math.round(t * 255);
      pixels[o + 1] = Math.round(t * 255);
      pixels[o + 2] = Math.round(t * 255);
    }
  }
  const path = join(REPO_ROOT, 'shots', 'terrain-mesh.png');
  mkdirSync(join(REPO_ROOT, 'shots'), { recursive: true });
  await writeCleanPng(pixels, { width: n, height: n }, path);
  process.stdout.write(`${path}\n`);
}

const mesh = build();
mkdirSync(OUT_DIR, { recursive: true });

// Positions and texture coordinates back to back, so the bake script reads two
// counts and two blocks and needs to know nothing else.
writeFileSync(join(OUT_DIR, 'terrain-mesh.bin'), Buffer.concat([
  Buffer.from(mesh.positions.buffer),
  Buffer.from(mesh.uvs.buffer),
]));

// The stair goes over the same wire, in the same order, with its indices after
// the vertices: it is not a grid, so the bake cannot work its faces out from a
// side length the way it does for the ground.
const stairs = stairMesh();
writeFileSync(join(OUT_DIR, 'stairs-mesh.bin'), Buffer.concat([
  Buffer.from(stairs.positions.buffer),
  Buffer.from(stairs.uvs.buffer),
  Buffer.from(new Uint32Array(stairs.indices).buffer),
]));

const meta = {
  samples: mesh.n,
  half: GRID.half,
  bend: GRID.bend,
  centreX: GRID.centreX,
  centreZ: GRID.centreZ,
  vertices: mesh.n * mesh.n,
  triangles: (mesh.n - 1) * (mesh.n - 1) * 2,
  height: { min: Number(mesh.min.toFixed(4)), max: Number(mesh.max.toFixed(4)) },
  centreline: Array.from({ length: 65 }, (unused, k) => {
    const z = -20 + (44 * k) / 64;
    return [Number(pathCentreX(z).toFixed(4)), Number(z.toFixed(4))];
  }),
  stairs: {
    atlas: ATLAS,
    vertices: stairs.positions.length / 3,
    indices: stairs.indices.length,
    faces: stairs.faces.length,
  },
  // Everything that stands on the ground and therefore drops light off it. The
  // bake needs them present to darken the grass where they meet it; they are
  // not exported, they only cast.
  occluders: [
    ...MONOLITHS.map((m) => ({
      name: `monolith-${m.id}`,
      size: m.size,
      x: m.position.x,
      y: m.baseY,
      z: m.position.z,
      rotationY: m.rotationY,
    })),
    {
      name: 'platform',
      size: [PLATFORM.width, PLATFORM.height, PLATFORM.depth],
      x: PLATFORM.x,
      y: 0,
      z: PLATFORM.z,
      rotationY: PLATFORM.rotationY,
    },
    ...Array.from({ length: STAIRS.steps }, (unused, k) => {
      const height = PLATFORM.height * (STAIRS.steps - k) / STAIRS.steps;
      return {
        name: `step-${k}`,
        size: [STAIRS.width, height, STAIRS.tread],
        x: STAIRS.x,
        y: 0,
        z: STAIRS.z + STAIRS.tread * (k + 0.5),
        rotationY: 0,
      };
    }),
  ],
};
writeFileSync(join(OUT_DIR, 'field.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

process.stdout.write(`${mesh.n}x${mesh.n} grid, ${meta.vertices} vertices, `
  + `${meta.triangles} triangles, reach ${GRID.half} m\n`);
process.stdout.write(`height ${mesh.min.toFixed(2)} .. ${mesh.max.toFixed(2)} m\n`);
process.stdout.write(`${join(OUT_DIR, 'terrain-mesh.bin')}\n`);
process.stdout.write(`stair ${stairs.faces.length} faces, ${stairs.indices.length / 3} triangles, `
  + `${ATLAS}x${ATLAS} atlas\n`);

if (!process.argv.includes('--no-preview')) await preview(mesh);
