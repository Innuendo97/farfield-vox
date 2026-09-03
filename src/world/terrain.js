import {
  BufferAttribute, BufferGeometry, ClampToEdgeWrapping, Mesh, RepeatWrapping,
} from 'three';
import { DETAIL, createBakedMaterial } from './air.js';
import TERRAIN from '../../assets-src/terrain/terrain.json' with { type: 'json' };
import {
  GRID, gridToOffset, heightAt, pathCoord, pathRun,
} from './terrain-field.js';
import { AREA_CENTER } from './layout.js';
import { pathStripUv } from './path-strip.js';

// WHAT IS LEFT OF THE BENT GRID, AND WHY IT IS NOT NOTHING.
//
// THIS FILE USED TO BE THE MEADOW. It is not any more: the meadow is ten
// centimetre cubes out to the tier's radius (src/world/ground-voxel.js) and a
// snapped sheet from there to a hundred metres (src/world/ground-shell.js).
// What is left here is the PAVING -- the corridor of stone the walker arrives
// along -- and the few square metres of ground under the blocks' own footprints,
// which are the only places the disc deliberately lays no cube.
//
// SO THE GRID IS CUT DOWN TO WHAT IT STILL DRAWS. It was 192 by 192 vertices
// over a square two hundred metres across -- 36 481 quads, 72 962 triangles,
// with the frustum test switched off, every frame, for ever -- and almost all of
// it was meadow that is now cubes or sheet. Two surfaces drawing the same ground
// is not a saving problem, it is a z-fight and a double answer about the floor.
//
// AND IT IS THE 100 m SEAM E-V5h ASKED FOR. The retired half is the half that
// reached past a hundred metres: on its axes the grid stopped at a hundred, but
// at its corners it reached a hundred and forty one, and V5's terraces are drawn
// out there -- 0.08 to 0.11 blobs per thousand against the target's 2.73, which
// is a gate failing V5 for a plane of V1's. Nothing of this file now reaches
// past the disc except along the paving.
//
// GROUND_SIZE = 400 IS NOT WHAT MADE THAT OVERRUN, and it is written down here
// because the amendment names it: it is an export of src/world/layout.js with
// ZERO readers -- checked over the whole tree, both by name and by import -- so
// there is no four hundred metre plane and there never was one in this branch.
// The extent that was real is GRID.half, and it is a hundred. The dead literal
// is one line in a file E-V2f froze, so it is left for the coordinator rather
// than taken here.
//
// WHAT DOES NOT LEAVE WITH THE MEADOW, AND IT IS THE ONE THAT WAS PROMISED.
// E-V4f.4 holds terrain-light.ktx2 in the critical set until V1 retires its
// atlas. V1 has retired its atlas's MEADOW and cannot retire the atlas: the
// paving's colour and the paving's baked shadow are both in it, and the paving
// is V3's surface, unbuilt. The map that leaves the critical set is the one
// nothing reads any more, and today that is none of the four. Measured, in the
// verbale, rather than asserted here.
//
// THE GROUND, AND FROM HERE ON IT IS THE SOIL SESSION'S ALONE.
//
// The air this stands in, the fitted exposure of it, and the factory that
// builds a painted-albedo-times-baked-light surface all left for
// src/world/air.js, because five other modules were reading them out of this
// file and could not be left depending on the one file the ground gets rewritten
// in. The height under a foot left too, for src/world/contracts.js, because
// three other sessions have to ask it and none of them may ask this file.
//
// What is here is the mesh of the meadow and the hanging of it, and one module
// imports it: src/world/layers/v1-suolo.js, which is the same session's.

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
 *
 * CUT DOWN TO WHAT IT STILL DRAWS. The vertices are all laid -- they cost
 * nothing on the wire and dropping them would renumber the index -- and the
 * INDEX is built only over the quads that are still this file's: inside the
 * disc, where the cubes leave the paving and the blocks' footprints bare, and
 * along the corridor wherever it runs, which is out to z = 30 and so past any
 * radius a tier will hand it.
 *
 * @param {number} radius  where the disc of cubes ends, in metres
 */
function buildGround(radius) {
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

  // How far off the middle of the run a quad may stand and still be the
  // corridor. The stone itself is |pathCoord| < 1 and the verge the material
  // beds it into reaches 1.4; two is that with a margin.
  //
  // AND THE SIGN OF THIS TEST IS THE OPPOSITE OF WHAT IT WAS, which is a defect
  // this grid could not have had until now. It used to KEEP the corridor's band
  // out past the rim of the disc, because the paving was a surface of its own
  // and needed ground drawn under it where the disc had none. That surface is
  // gone: past the rim the sheet draws the corridor's passage like any other
  // ground, and inside the rim the corridor is COLUMNS of the disc.
  //
  // Which turned this grid into a fight. The paving's top face lands at exactly
  // BASE_LEVEL -- one voxel under the meadow's floor is what puts the grass one
  // to two voxels proud of the stone -- and this grid is drawn at heightAt,
  // which IS BASE_LEVEL since the ground became a plane. Two coplanar surfaces,
  // and what the frame draws between them is whichever the depth test happens
  // to pick, in torn patches that move with the eye. It never showed before
  // because V3's surface stood four millimetres over it, on a lift that existed
  // to clear the meadow's own triangles; killing the lift is what uncovered it.
  //
  // So the band is DROPPED rather than kept. Where the meadow's cubes stand
  // there is nothing to see under them either way; where the paving stands, the
  // paving is the ground. The whole of this grid dies at step 7 and this is the
  // one line of it that could not wait.
  const CORRIDOR = 2.0;
  const quads = (n - 1) * (n - 1);
  const indices = quads * 6 > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  let k = 0;
  let kept = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      // The quad's own middle, in metres, from the two indices it spans.
      const x = GRID.centreX + gridToOffset(((i + 0.5) / (n - 1)) * 2 - 1);
      const z = GRID.centreZ + gridToOffset(((j + 0.5) / (n - 1)) * 2 - 1);
      const near = Math.hypot(x - AREA_CENTER.x, z - AREA_CENTER.z) <= radius;
      const corridor = pathRun(z) > 0.02 && Math.abs(pathCoord(x, z)) < CORRIDOR;
      if (!near || corridor) continue;
      kept++;
      indices[k++] = a; indices[k++] = a + n; indices[k++] = a + n + 1;
      indices[k++] = a; indices[k++] = a + n + 1; indices[k++] = a + 1;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('verge', new BufferAttribute(verge, 1));
  geometry.setAttribute('pathStrip', new BufferAttribute(strip, 2));
  geometry.setIndex(new BufferAttribute(indices.subarray(0, k), 1));
  geometry.computeBoundingSphere();
  geometry.userData.kept = kept;
  geometry.userData.wasQuads = quads;
  return geometry;
}

/**
 * Builds the ground.
 *
 * One mesh, one material, nothing animated: the path is stone all the way
 * across, lit and shaded by the bake alone.
 *
 * @param {object} assets  albedo and light textures
 * @returns {{ meshes: Mesh[] }}
 */
export function createTerrain({
  albedo, light, detail = null, strip = null, lightScale = TERRAIN.lightScale,
  radius,
}) {
  const meshes = [];
  let geometry = null;

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
    geometry = buildGround(radius);
    const ground = new Mesh(geometry, material);
    ground.name = 'terrain';
    ground.frustumCulled = false;
    meshes.push(ground);
  }

  return {
    meshes,
    // What is left of the grid, so the retirement is a number in the page and
    // not a claim in a comment.
    built: geometry ? {
      quads: geometry.userData.kept,
      triangles: geometry.userData.kept * 2,
      wasQuads: geometry.userData.wasQuads,
      wasTriangles: geometry.userData.wasQuads * 2,
    } : null,
  };
}
