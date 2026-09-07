import { WebGLRenderer, SRGBColorSpace } from 'three';
import { createPostPipeline } from './post.js';

// Presentation layer facade. Everything that draws goes through here so the
// scene code never depends on a concrete graphics backend.

// Above ~1.5 the extra pixels buy nothing visible on the target hardware
// (mid-range integrated GPUs) while costing fill rate linearly.
const MIN_PIXEL_RATIO = 1.0;
const MAX_PIXEL_RATIO = 1.5;

export class Renderer {
  #gl = null;
  #canvas = null;
  #post = null;
  // Fraction of the display's own pixels the world is drawn into. The canvas is
  // stretched to the viewport by the stylesheet, so lowering this hands the
  // upscale to the display engine and costs the frame nothing to undo.
  #scale = 1;
  #width = 1;
  #height = 1;

  init(canvas) {
    this.#canvas = canvas;
    this.#gl = new WebGLRenderer({
      canvas,
      // Antialiasing is done by the offscreen buffer the scene is drawn into,
      // so asking for it on the canvas would only pay for it twice.
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.#gl.outputColorSpace = SRGBColorSpace;
    // No dynamic shadows anywhere in this project: the whole lighting model is
    // baked, so the shadow pipeline must never be paid for.
    this.#gl.shadowMap.enabled = false;
    this.#post = createPostPipeline(this.#gl);
    this.resize();
    return this;
  }

  resize(width = window.innerWidth, height = window.innerHeight) {
    this.#width = width;
    this.#height = height;
    const ratio = this.pixelRatio;
    this.#gl.setPixelRatio(ratio);
    this.#gl.setSize(width, height, false);
    // The offscreen buffers are sized in real pixels, not in layout pixels.
    this.#post.setSize(width * ratio, height * ratio);
    return { width, height, aspect: width / height };
  }

  get pixelRatio() {
    const device = Math.min(MAX_PIXEL_RATIO, Math.max(MIN_PIXEL_RATIO, window.devicePixelRatio || 1));
    return device * this.#scale;
  }

  get renderScale() { return this.#scale; }

  /**
   * First lever of the quality tier: how many pixels the world is drawn into.
   *
   * It comes before every other cut because it is the only one that touches
   * nothing about what is in the frame — the same meadow, the same halo, the
   * same grade, over fewer samples — and because fill rate is what an
   * integrated GPU runs out of first.
   */
  setRenderScale(scale) {
    if (scale === this.#scale) return false;
    this.#scale = scale;
    this.resize(this.#width, this.#height);
    return true;
  }

  /** The buffer the world is drawn into, in real pixels. */
  drawingBuffer() {
    const ratio = this.pixelRatio;
    return { width: Math.floor(this.#width * ratio), height: Math.floor(this.#height * ratio) };
  }

  render(scene, camera) {
    this.#post.render(scene, camera);
  }

  /**
   * Compiles ahead of the frame that would otherwise pay for it.
   *
   * Forwarded rather than reached for, like everything else here: the caller
   * says WHEN the world has changed shape and does not learn what a render
   * target is. See warm() in src/core/post.js for why it cannot be done
   * against the default framebuffer.
   */
  warm(scene, camera, targetScene = null) {
    return this.#post.warm(scene, camera, targetScene);
  }

  // The one seam the presentation layer deliberately exposes: the grading and
  // bloom parameters, so a development panel can move them without anyone else
  // learning what draws the frame.
  get post() {
    return this.#post;
  }

  // Compressed texture loaders must probe which formats the GPU accepts, and
  // that probe needs the live backend. Handing the loader in here keeps the
  // backend private instead of exposing it to whoever loads textures.
  configureTextureLoader(loader) {
    loader.detectSupport(this.#gl);
    return loader;
  }

  // The rest of the tier, forwarded so that nobody outside has to learn that a
  // sample count and a halo are properties of the frame assembly.
  setSamples(count) { return this.#post.setSamples(count); }

  setBloomTier(tier) { return this.#post.setBloomTier(tier); }

  /**
   * Second lever of the tier, and the one that does NOT touch the picture the
   * portfolio is made of.
   *
   * setRenderScale above takes the whole frame down together, writing included:
   * the meadow holds it and the engraving on the monolith does not. This takes
   * the pixel from the ray marched GROUND alone -- two thirds of the frame, and
   * a cost that tracks its own pixel count to within a point -- and leaves the
   * masonry, the writing, the flowers and the walker at the pixel they were
   * always drawn at.
   */
  setCampoScale(scale) { return this.#post.setCampoScale(scale); }

  /** How many samples the ground's own buffer resolves. A bench's arm. */
  setCampoSamples(count) { return this.#post.setCampoSamples(count); }

  /** What that buffer actually is, read back rather than deduced. */
  campoStats() { return this.#post.campoStats(); }

  setTiming(on) { return this.#post.setTiming(on); }

  /** What the GPU spent on the last timed frame, in milliseconds, or null. */
  timings() { return this.#post.timings(); }

  /** How many frames the clock timed, and why the rest were lost. */
  clockStats() { return this.#post.clockStats(); }

  get hasGpuClock() { return this.#post.hasGpuClock; }

  // Neutral snapshot for instrumentation: no backend types leak out.
  stats() {
    const info = this.#gl.info;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs ? info.programs.length : 0,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
  }

  get domElement() {
    return this.#canvas;
  }

  dispose() {
    this.#post.dispose();
    this.#gl.dispose();
    this.#post = null;
    this.#gl = null;
    this.#canvas = null;
  }
}
