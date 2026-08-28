import {
  LinearFilter, LinearMipmapLinearFilter, LinearSRGBColorSpace, SRGBColorSpace,
} from 'three';

// Asset gateway. Everything that reaches the GPU from the network passes here,
// so there is a single place that knows the transport formats (glTF + meshopt
// geometry, KTX2 textures) and a single place where the download budget is
// enforced.
//
// The loaders themselves are pulled in with a dynamic import: they are only
// needed once there is something to stream, and keeping them out of the entry
// chunk is what lets the first frame start drawing while they arrive.

const MANIFEST_URL = 'assets/manifest.json';

// Hard budget for the walkable first frame. Anything the player must see before
// moving has to fit here; everything else is streamed afterwards. The asset
// build enforces the same number offline, this is the runtime backstop.
export const FIRST_FRAME_BUDGET_BYTES = 6 * 1024 * 1024;

const PRIORITIES = ['critical', 'high', 'deferred'];

function priorityRank(priority) {
  const rank = PRIORITIES.indexOf(priority);
  return rank === -1 ? PRIORITIES.length : rank;
}

export class Assets {
  #base;
  #renderer;
  #manifest = null;
  #manifestPromise = null;
  #loaders = null;
  #loadersPromise = null;
  #entries = new Map();
  #cache = new Map();
  #inflight = new Map();

  constructor(base = './') {
    this.#base = base.endsWith('/') ? base : `${base}/`;
  }

  // The KTX2 loader has to ask the live backend which compressed formats the
  // GPU accepts, so the renderer facade hands itself over instead of the scene
  // code holding a reference to the graphics backend.
  setRenderer(renderer) {
    this.#renderer = renderer;
    return this;
  }

  url(path) {
    return `${this.#base}${path}`;
  }

  async manifest() {
    if (this.#manifest) return this.#manifest;
    if (!this.#manifestPromise) {
      this.#manifestPromise = fetch(this.url(MANIFEST_URL))
        .then((response) => {
          if (!response.ok) throw new Error(`manifest unavailable (${response.status})`);
          return response.json();
        })
        .then((manifest) => {
          this.#manifest = manifest;
          for (const entry of manifest.assets || []) this.#entries.set(entry.id, entry);
          return manifest;
        });
    }
    return this.#manifestPromise;
  }

  // Declared cost of the walkable first frame, in bytes.
  criticalBytes() {
    let total = 0;
    for (const entry of this.#entries.values()) {
      if (entry.priority === 'critical' && entry.scope !== 'dev') total += entry.bytes;
    }
    return total;
  }

  async #ensureLoaders() {
    if (this.#loaders) return this.#loaders;
    if (!this.#loadersPromise) {
      this.#loadersPromise = (async () => {
        const [{ GLTFLoader }, { KTX2Loader }, { MeshoptDecoder }] = await Promise.all([
          import('three/examples/jsm/loaders/GLTFLoader.js'),
          import('three/examples/jsm/loaders/KTX2Loader.js'),
          import('three/examples/jsm/libs/meshopt_decoder.module.js'),
        ]);

        // No transcoder path: left empty, the loader resolves the Basis
        // transcoder through the bundler, which emits and fingerprints it as a
        // dependency of this chunk instead of leaving a vendored copy to rot.
        const ktx2 = new KTX2Loader();
        if (this.#renderer) this.#renderer.configureTextureLoader(ktx2);

        const gltf = new GLTFLoader()
          .setKTX2Loader(ktx2)
          .setMeshoptDecoder(MeshoptDecoder);

        this.#loaders = { gltf, ktx2 };
        return this.#loaders;
      })();
    }
    return this.#loadersPromise;
  }

  async #fetchOne(entry) {
    // A table rather than a picture: the numbers a shader needs beside a texture
    // it cannot hold — coefficient curves, ranges, where a piece stands. It
    // takes none of the loaders, so it is answered before they are asked for.
    if (entry.type === 'json') {
      const response = await fetch(this.url(entry.url));
      if (!response.ok) throw new Error(`${entry.id} unavailable (${response.status})`);
      return response.json();
    }
    const { gltf, ktx2 } = await this.#ensureLoaders();
    if (entry.type === 'model') {
      const result = await gltf.loadAsync(this.url(entry.url));
      return result.scene;
    }
    const texture = await ktx2.loadAsync(this.url(entry.url));
    // Normal maps carry geometry, not colour, the cloud basis maps carry
    // logarithms, and a cloud's coverage is a fraction of a fragment:
    // transcoding any of them through sRGB would bend what the shader reads
    // into something else. Only pictures get the transfer.
    texture.colorSpace = entry.role === 'normal' || entry.role === 'data' || entry.role === 'coverage'
      ? LinearSRGBColorSpace : SRGBColorSpace;
    // AND A COVERAGE IS INTERPOLATED, which the transcoder does not assume.
    //
    // The block-coded textures come back from KTX2Loader filtered linearly; an
    // uncompressed one — which is what a coverage is, deliberately, because a
    // block codec cannot hold a block that is part cloud and part nothing —
    // comes back NEAREST on both filters. Measured on the delivered frame: every
    // silhouette in the sky is then quantised to a whole texel of the atlas,
    // which at this sampling rate is about two pixels, and the result is the
    // staircase round every bank that the coverage was given its own file to be
    // rid of. A coverage is a FRACTION of a fragment and the fraction between
    // two texels is the average of them; there is no reading of it under which
    // nearest is right.
    if (entry.role === 'coverage') {
      texture.magFilter = LinearFilter;
      texture.minFilter = texture.mipmaps && texture.mipmaps.length > 1
        ? LinearMipmapLinearFilter : LinearFilter;
    }
    texture.flipY = false;
    texture.needsUpdate = true;
    return texture;
  }

  get(id) {
    return this.#cache.get(id) || null;
  }

  async load(id) {
    if (this.#cache.has(id)) return this.#cache.get(id);
    if (this.#inflight.has(id)) return this.#inflight.get(id);

    await this.manifest();
    const entry = this.#entries.get(id);
    if (!entry) throw new Error(`unknown asset "${id}"`);

    const promise = this.#fetchOne(entry).then((value) => {
      this.#cache.set(id, value);
      this.#inflight.delete(id);
      return value;
    });
    this.#inflight.set(id, promise);
    return promise;
  }

  /**
   * What a named piece weighs, in bytes, as the delivery declared it.
   *
   * The declared weight and not the transferred one: anything that wants to
   * show how far a load has got has to know the size of what it is waiting for
   * BEFORE it arrives, and the manifest is the only place that number exists
   * ahead of time. Zero for a name the manifest does not carry, and zero before
   * the manifest is down — a weight nobody has been told is not a weight.
   */
  bytesOf(id) {
    const entry = this.#entries.get(id);
    return entry ? entry.bytes : 0;
  }

  // Everything the first walkable frame needs, in parallel: this is the only
  // load the player is ever made to wait for.
  //
  // AND IT CAN BE WATCHED, BY WEIGHT AND NOT BY COUNT. These pieces are not
  // equal things — the ground's albedo is the better part of the whole
  // delivery — so a fraction counted in files would sit still for the length of
  // the load and then jump to the end. What the callback is handed is the bytes
  // that have landed against the bytes that were declared, and the name of the
  // piece that just landed.
  //
  // Called with nothing it is the load it has always been: the same Promise.all
  // over the same ids, with no closure between the fetch and the caller.
  async loadCritical(onProgress) {
    await this.manifest();
    const bytes = this.criticalBytes();
    if (bytes > FIRST_FRAME_BUDGET_BYTES) {
      throw new Error(`first frame over budget: ${bytes} B > ${FIRST_FRAME_BUDGET_BYTES} B`);
    }
    const entries = [...this.#entries.values()]
      .filter((entry) => entry.priority === 'critical' && entry.scope !== 'dev');
    if (!onProgress) return Promise.all(entries.map((entry) => this.load(entry.id)));
    let landed = 0;
    return Promise.all(entries.map((entry) => this.load(entry.id).then((value) => {
      landed += entry.bytes;
      onProgress(landed, bytes, entry.id);
      return value;
    })));
  }

  // Everything else, one at a time and in priority order, so a stream never
  // competes with the frame the player is already walking in.
  async stream(onProgress) {
    await this.manifest();
    const pending = [...this.#entries.values()]
      .filter((entry) => entry.priority !== 'critical' && entry.scope !== 'dev')
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));

    for (let i = 0; i < pending.length; i++) {
      await this.load(pending[i].id);
      if (onProgress) onProgress((i + 1) / pending.length, pending[i].id);
    }
  }

  dispose() {
    for (const value of this.#cache.values()) {
      if (value && typeof value.dispose === 'function') value.dispose();
    }
    this.#cache.clear();
    if (this.#loaders) this.#loaders.ktx2.dispose();
    this.#loaders = null;
    this.#loadersPromise = null;
  }
}
