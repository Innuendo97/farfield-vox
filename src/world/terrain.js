import {
  BufferAttribute, BufferGeometry, ClampToEdgeWrapping, Mesh, RepeatWrapping,
} from 'three';
import { DETAIL, createBakedMaterial } from './air.js';
import TERRAIN from '../../assets-src/terrain/terrain.json';
import {
  FIELD, GRID, gridToOffset, heightAt, pathCoord,
} from './terrain-field.js';
import { pathStripUv } from './path-strip.js';

// THE GROUND, AND FROM HERE ON IT IS THE SOIL SESSION'S ALONE.
//
// The air this stands in, the fitted exposure of it, and the factory that
// builds a painted-albedo-times-baked-light surface all left for
// src/world/air.js, because five other modules were reading them out of this
// file and could not be left depending on the one file the ground gets rewritten
// in. What is here is the ground and nothing else: the mesh, the height under a
// foot, and the hanging of the two.

// The ground.
//
// Nothing here is lit at draw time — with ONE exception, named and fenced in
// at DETAIL.relief in src/world/air.js. The colour of the meadow is a painted
// albedo, the light on it is a baked map, and the frame multiplies the two and
// puts the result through the fog. That is the whole material. It is also the
// reason the reference is reachable at all on an integrated GPU: the picture has
// no dynamic light in it to reproduce.
//
// The exception is the last two metres under the walker's own feet, where the
// bake's texel is five centimetres and a stone is three: there, and only there,
// the sun term of the bake is bent by the slope of a micro relief that no atlas
// of that resolution can hold. It is the sun OF THE SEAT and not a second light,
// it is switched off by the same fade as the material it belongs to, and past
// that fade this file is what it always was.

// The path is not separate geometry. It is painted into the terrain albedo and
// cut into the height field, because it is the same ground: giving it its own
// mesh would mean a second surface to keep in register with the first, and a
// seam along both edges of it for the whole length of the run.

/**
 * The ground mesh.
 *
 * Built here rather than streamed as geometry. The field is already in the
 * bundle, so a mesh from it costs a few milliseconds at startup and nothing on
 * the wire, and it cannot disagree with the height the walker is standing on.
 * Sending it through glTF instead cost a quarter of a megabyte and lost the
 * texture coordinates on the way, because a mesh with no material has nothing
 * that uses them and the exporter drops them.
 *
 * No normals: nothing here is lit at draw time.
 */
function buildGround() {
  const n = GRID.samples;
  const positions = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  // How far across the path this vertex stands, one at the edge. Carried on the
  // mesh rather than solved in the shader: see DETAIL.verge in air.js.
  const verge = new Float32Array(n * n);
  // And where it stands on the path's own strip. Two more floats a vertex, which
  // is 295 kB of VRAM built at startup and NOT ONE BYTE on the wire — the mesh
  // is arithmetic in the bundle, so a second attribute costs the load nothing.
  // No position moves, so the silhouette cannot: see the guard.
  const strip = new Float32Array(n * n * 2);

  for (let j = 0; j < n; j++) {
    const v = j / (n - 1);
    const z = GRID.centreZ + gridToOffset(v * 2 - 1);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const x = GRID.centreX + gridToOffset(u * 2 - 1);
      const o = (j * n + i) * 3;
      positions[o] = x;
      positions[o + 1] = heightAt(x, z);
      positions[o + 2] = z;
      const t = (j * n + i) * 2;
      uvs[t] = u;
      uvs[t + 1] = v;
      verge[j * n + i] = Math.min(1.4, Math.abs(pathCoord(x, z)));
      const on = pathStripUv(x, z);
      strip[(j * n + i) * 2] = on.u;
      strip[(j * n + i) * 2 + 1] = on.v;
    }
  }

  const quads = (n - 1) * (n - 1);
  const indices = quads * 6 > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  let k = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      indices[k++] = a; indices[k++] = a + n; indices[k++] = a + n + 1;
      indices[k++] = a; indices[k++] = a + n + 1; indices[k++] = a + 1;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('verge', new BufferAttribute(verge, 1));
  geometry.setAttribute('pathStrip', new BufferAttribute(strip, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Height of the ground under a point, in metres.
 *
 * The field is arithmetic and could be evaluated directly, but it is sampled
 * into a grid once and read back bilinearly instead: the walker asks for this
 * every frame, and a grid read costs the same whatever the field grows into
 * later.
 */
export function createHeightSampler() {
  const { samples, originX, originZ, spacing } = FIELD;
  const grid = new Float32Array(samples * samples);
  for (let j = 0; j < samples; j++) {
    const z = originZ + j * spacing;
    for (let i = 0; i < samples; i++) {
      grid[j * samples + i] = heightAt(originX + i * spacing, z);
    }
  }

  return function height(x, z) {
    const fx = (x - originX) / spacing;
    const fz = (z - originZ) / spacing;
    // Outside the grid the field is flat, so the rim value is the right answer.
    const i = Math.max(0, Math.min(samples - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(samples - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i));
    const tz = Math.max(0, Math.min(1, fz - j));
    const a = grid[j * samples + i];
    const b = grid[j * samples + i + 1];
    const c = grid[(j + 1) * samples + i];
    const d = grid[(j + 1) * samples + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
}

/**
 * Builds the ground.
 *
 * One mesh, one material, nothing animated: the path is stone all the way
 * across, lit and shaded by the bake alone.
 *
 * @param {object} assets  albedo and light textures
 * @returns {{ meshes: Mesh[], height: Function }}
 */
export function createTerrain({
  albedo, light, detail = null, strip = null, lightScale = TERRAIN.lightScale,
}) {
  const height = createHeightSampler();
  const meshes = [];

  if (albedo && light) {
    if (detail) {
      // It repeats, which is the whole point of it, and it is filtered the way
      // the atlas beside it is.
      //
      // ANISOTROPIC FOR THE SAME REASON AND MORE SO. Where this is switched on
      // the ground is seen from close to and steeply foreshortened: over the
      // stretch the close reference frames, a pixel covers two to three
      // millimetres of ground across the frame and three to five times that down
      // it. An isotropic filter is forced by the larger of those, so it would
      // choose a mip by the length and average away everything finer — which is
      // everything this tile has. Eight, as the albedo has: three clamps it to
      // what the device can do when it uploads.
      detail.wrapS = RepeatWrapping;
      detail.wrapT = RepeatWrapping;
      detail.anisotropy = 8;
      detail.needsUpdate = true;
    }
    if (strip) {
      // CLAMPED, and it is not a formality: this one does NOT repeat. It is laid
      // once along the run, so a wrap would fetch the far end of the path for
      // ground just off the near end of it.
      strip.wrapS = ClampToEdgeWrapping;
      strip.wrapT = ClampToEdgeWrapping;
      // FOUR, WHERE THE ATLAS AND THE TILE GET EIGHT, and the difference is
      // argued rather than saved. What anisotropy buys is resolution along the
      // long axis of a footprint, and this texture's long axis is the run, where
      // it is already the coarser of its two pitches; four covers the ratio the
      // strip is actually seen at over the metres it is alive, and the taps it
      // does not take are fill on the busiest fragments in the frame.
      strip.anisotropy = 4;
      strip.needsUpdate = true;
    }
    // ANISOTROPIC, AND ONLY THIS ONE MAP.
    //
    // `gridToOffset` has zero derivative at the origin and the grid's centre is
    // x = 0 exactly, so the middle quad of the mesh buildGround() lays down is
    // 1.9 mm wide and carries 10.7 texels of atlas under it. The derivative of
    // the texture coordinate on those fragments is an order of magnitude larger
    // across the run than along it, and an isotropic filter is forced by the
    // larger of the two: it averages down the run as well, and hands back the
    // atlas smeared over a metre and a half of path instead of the stone under
    // the pixel. Because it is the same column of atlas for the whole length of
    // the run, that reads as a dark line down the middle of the path — the one
    // check-path-bands --along was written for.
    //
    // Eight because eight already reproduces level zero on those columns, code
    // for code, and three clamps it to the GPU's own maximum when it uploads,
    // so a device that cannot do eight gets what it can. Not the light map: the
    // same measurement found the light flat across those columns whatever it
    // was filtered with, so it is not what draws the line.
    albedo.anisotropy = 8;
    const material = createBakedMaterial({
      albedo, light, lightScale, detail, detailGain: DETAIL.gain, strip,
    });
    const ground = new Mesh(buildGround(), material);
    ground.name = 'terrain';
    ground.frustumCulled = false;
    meshes.push(ground);
  }

  return { meshes, height };
}
