import { Mesh, MeshBasicMaterial } from 'three';

// End to end check of the asset pipeline, kept out of the product build.
// It loads the model produced by tools/bake/bake.py after it has gone through
// meshopt compression and KTX2 encoding, and shows the baked light on its own,
// unlit: if the transcoder, the second UV set or the encoder were wrong, the
// surfaces would come out flat or black instead of shaded.
//
// Enabled only with ?dev&baketest, so the reference framing stays clean.

const ASSET_ID = 'baketest-scene';

export function isBakeTestEnabled() {
  return new URLSearchParams(window.location.search).has('baketest');
}

// Placed beside the path, clear of the monoliths: the check has to be readable
// without hiding the framing it is being compared against.
export async function mountBakeTest(scene, assets, position = { x: 3.5, y: 0.02, z: 5 }) {
  const started = performance.now();
  const root = (await assets.load(ASSET_ID)).clone(true);

  let lightMaps = 0;
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const source = node.material;
    // The bake travels through glTF in the emissive slot, the only textured
    // channel the exporter binds to a second UV set.
    const baked = source.emissiveMap;
    if (!baked) return;
    lightMaps++;
    node.material = new MeshBasicMaterial({ color: 0xffffff, lightMap: baked });
    source.dispose();
  });

  root.position.set(position.x, position.y, position.z);
  scene.add(root);

  const elapsed = performance.now() - started;
  return {
    root,
    lightMaps,
    elapsedMs: elapsed,
    remove() {
      scene.remove(root);
      root.traverse((node) => {
        if (node instanceof Mesh) node.material.dispose();
      });
    },
  };
}
