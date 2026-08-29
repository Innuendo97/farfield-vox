import { chunkList, meshChunk, setGroundHole } from '../../src/world/voxel/pure.js';
import { groundHoleAt } from '../../src/world/contracts.js';
import { TIERS } from '../../src/core/quality.js';
import { lineOf, read, reporter, selfTest, walk } from './lib.mjs';

/** The largest disc any tier lays, which is the biggest one that ships. */
const SHIPPED_RADIUS = Math.max(...TIERS.map((t) => t.voxelDiscRadius));

// And where the ground is cut away, from the seat the page fills. Nothing here
// reads a COUNT -- this guard is about the shape of a chunk's buffers, and any
// real chunk would do -- but the note below says the guard must not mesh a disc
// the world does not lay, and since the corridor's own hole went into the engine
// that sentence has a second half. It costs one call.
setGroundHole(groundHoleAt);

// NEVER A PER-VOXEL PROPERTY IN A VERTEX ATTRIBUTE, AND THE PRICE IS MEASURED.
//
// The tint, the joint and the lightened arris are rebuilt in the fragment out of
// the fragment's own position. The moment any of them has to be handed over per
// vertex, a merged rectangle can no longer stand for a hundred cubes -- the merge
// dies and the geometry of the whole world goes up by THREE TIMES. It is one
// line of shader either way, and no review reads that line as a change to the
// budget, which is exactly why it is a guard and not a comment.
//
// TWO LEGS, BECAUSE THE RULE CAN BE BROKEN AT EITHER END.
//
// 1. WHAT THE MESHER HANDS BACK. The engine's own door is asked for two chunks
//    with different quad counts, and every buffer it returns is classified by
//    how its length SCALES: a buffer whose length is a whole small multiple of
//    four-per-quad in BOTH chunks is a vertex attribute, whatever it is called.
//    Two chunks and not one because a fixed-size buffer -- the height map is
//    4096 long -- can divide the vertex count of one chunk by coincidence and
//    cannot divide two.
//
// 2. WHAT IS ACTUALLY UPLOADED. A buffer can exist on the chunk for offline
//    statistics and never reach the card; the mesher's own `faces` does exactly
//    that. So the second leg reads the call sites: every BufferAttribute built
//    out of a chunk field, anywhere in src/, has to name one of the three.
//
// WHAT IS ALLOWED, AND WHY THESE THREE. The corner, the orientation, and the
// index that joins them. The normal is a property of the FACE and not of a
// voxel -- six values in the whole world, constant over any rectangle a merge
// could produce -- so it cannot split a merge. Where a chunk stands comes off
// its model matrix, which is one draw's constant rather than a fourth attribute.

const ALLOWED = new Set(['positions', 'normals', 'indices']);

/**
 * Which buffers of a mesher's output are shaped like vertex attributes.
 *
 * @param {object[]} chunks two or more chunks with DIFFERENT quad counts
 * @returns {{name: string, components: number}[]}
 */
export function vertexShaped(chunks) {
  const found = [];
  const names = new Set(chunks.flatMap((c) => Object.keys(c)));
  for (const name of names) {
    let components = null;
    let all = true;
    for (const chunk of chunks) {
      const value = chunk[name];
      const vertices = chunk.quads * 4;
      if (!ArrayBuffer.isView(value) || !vertices) { all = false; break; }
      const per = value.length / vertices;
      // A whole number of components a vertex, and no more than a vec4: past
      // that the buffer is not an attribute, it is a table that happens to be
      // long.
      if (!Number.isInteger(per) || per < 1 || per > 4) { all = false; break; }
      if (components === null) components = per;
      else if (components !== per) { all = false; break; }
    }
    if (all) found.push({ name, components });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Every chunk field a BufferAttribute is built out of, across the sources. */
export function uploadedFields(files) {
  const seen = [];
  for (const { path, text } of files) {
    const pattern = /new\s+BufferAttribute\s*\(\s*(\w+)\.(\w+)/g;
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      if (m[1] !== 'chunk') continue;
      seen.push({ path, line: lineOf(text, m.index), field: m[2] });
    }
  }
  return seen;
}

if (process.argv.includes('--self')) {
  const list = chunkList(SHIPPED_RADIUS);
  const real = list.map(({ cx, cz }) => meshChunk(cx, cz, true, SHIPPED_RADIUS))
    .filter((c) => c.quads > 0);
  const two = [real[0], real.find((c) => c.quads !== real[0].quads)];
  const injected = two.map((c) => ({ ...c, tint: new Uint8Array(c.quads * 4) }));
  const wide = two.map((c) => ({ ...c, aCell: new Float32Array(c.quads * 4 * 3) }));
  selfTest('guard-vertice', [
    {
      what: 'a per-voxel tint added to the mesher\'s output is seen as a vertex attribute',
      caught: vertexShaped(injected).some((a) => a.name === 'tint' && a.components === 1),
    },
    {
      what: 'a three-component per-voxel cell is seen too',
      caught: vertexShaped(wide).some((a) => a.name === 'aCell' && a.components === 3),
    },
    {
      what: 'the height map is not mistaken for one, though it can divide a chunk by luck',
      caught: !vertexShaped(two).some((a) => a.name === 'tops'),
    },
    {
      what: 'the per-quad face table is not mistaken for one either',
      caught: !vertexShaped(two).some((a) => a.name === 'faces'),
    },
    {
      what: 'a call site uploading chunk.tint is caught',
      caught: uploadedFields([{
        path: 'injected', text: 'geometry.setAttribute(\'aTint\', new BufferAttribute(chunk.tint, 1));',
      }]).some((u) => !ALLOWED.has(u.field)),
    },
    {
      what: 'a call site uploading chunk.positions is not',
      caught: uploadedFields([{
        path: 'injected', text: 'geometry.setAttribute(\'position\', new BufferAttribute(chunk.positions, 3));',
      }]).every((u) => ALLOWED.has(u.field)),
    },
  ]);
}

const report = reporter('guard-vertice -- nothing per voxel reaches a vertex');

// Two chunks with different quad counts, taken from the real disc so the shapes
// are the ones the world actually builds.
//
// AT THE RADIUS THAT SHIPS AND NOT AT THE ENGINE'S DEFAULT. The disc's reach is
// governed by quality.voxelDiscRadius now (E-V1a, E-V1d), so the tiers are the
// seat that says how big it is; the default is only what the engine answers
// when nobody asks. This check is about the SHAPE of a chunk's buffers, so any
// real chunk would do — reading the tier costs nothing and stops the guard from
// meshing, every run, a disc the world does not lay.
const built = chunkList(SHIPPED_RADIUS)
  .map(({ cx, cz }) => meshChunk(cx, cz, true, SHIPPED_RADIUS)).filter((c) => c.quads > 0);
const pair = [built[0], built.find((c) => c.quads !== built[0].quads)].filter(Boolean);

report.check(pair.length === 2, 'the disc offers two chunks of different size to compare',
  pair.map((c) => `${c.quads} quads`).join(' and '));

const attributes = vertexShaped(pair);
report.line(`  the mesher hands back: ${Object.keys(pair[0]).join(', ')}`);
report.line(`  of those, shaped like a vertex attribute: `
  + `${attributes.map((a) => `${a.name} (${a.components})`).join(', ') || 'none'}`);

for (const attribute of attributes) {
  report.check(ALLOWED.has(attribute.name),
    `${attribute.name} is a corner, an orientation or an index`,
    ALLOWED.has(attribute.name) ? '' : 'A PER-VOXEL PROPERTY IN A VERTEX ATTRIBUTE');
}

const sources = walk('src', (path) => path.endsWith('.js'))
  .map((path) => ({ path, text: read(path) }));
const uploads = uploadedFields(sources);
report.line('');
report.line(`  ${uploads.length} buffer${uploads.length === 1 ? '' : 's'} of a chunk `
  + 'are uploaded anywhere in src/');
for (const upload of uploads) {
  report.check(ALLOWED.has(upload.field),
    `${upload.path}:${upload.line} uploads chunk.${upload.field}`,
    ALLOWED.has(upload.field) ? '' : 'NOT one of the three the merge survives');
}

report.end();
