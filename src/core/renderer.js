import { WebGLRenderer, SRGBColorSpace } from 'three';
import { createPostPipeline } from './post.js';
import { MAX_PIXEL_RATIO, MIN_PIXEL_RATIO } from './inquadratura.js';

// Presentation layer facade. Everything that draws goes through here so the
// scene code never depends on a concrete graphics backend.

// THE TWO CEILINGS ON THE DEVICE RATIO MOVED, AND NOTHING ABOUT THEM CHANGED.
// They live in src/core/inquadratura.js now, beside the two ceilings on the
// framing and the floor under it, because that module's whole subject is how
// many pixels this world is allowed to draw and these were the first two rules
// of it. See the note there.

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
  // AND THE CANVAS IS NOT THE PICTURE (src/core/cornice.js). The world is drawn
  // into the picture and only into it; the canvas is larger by the frame's
  // margin, and the one pass that visits it is the composite. Equal to the
  // picture wherever there is no frame, which is every measured page of this
  // campaign and every guard.
  #canvasWidth = 1;
  #canvasHeight = 1;

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{width:number,height:number}|null} frame  the framing, if the page
   *        has already measured one. Without it the window is the framing,
   *        which is what every visit was before src/core/inquadratura.js.
   * @param {{width:number,height:number}|null} tela   the canvas, when the
   *        frame of src/core/cornice.js makes it larger than the picture.
   *        Without it the canvas IS the picture, to the byte.
   */
  init(canvas, frame = null, tela = null) {
    this.#canvas = canvas;
    this.#gl = new WebGLRenderer({
      canvas,
      // Antialiasing is done by the offscreen buffer the scene is drawn into,
      // so asking for it on the canvas would only pay for it twice.
      antialias: false,
      // AND THE CANVAS CARRIES ALPHA NOW, which is what lets the picture have
      // a soft edge without a second layer over it: the composite writes how
      // much of the world each pixel keeps, and what shows through is the night
      // the picture stands on rather than a colour somebody matched to it.
      //
      // ASKED FOR ALWAYS AND NOT ONLY WHERE THERE IS A FRAME, and the reason is
      // that it is a property of the CONTEXT: it is settled when the context is
      // made, before anything on this page knows what the bench will decide, and
      // a page that had to be reloaded to gain a soft edge is not a page. What
      // it costs is measured in the verbale — the composite writes a fourth
      // channel it was writing anyway, and the browser composites a layer it was
      // already compositing — and at `?cornice=0` every pixel of that channel is
      // one, so the picture on the glass is the picture that was measured.
      //
      // PREMULTIPLIED, and stated rather than left to the default: the
      // composite's last line writes colour times coverage, which is what a
      // compositor doing src + dst·(1 - a) needs. The two have to agree, and
      // this is where they are made to.
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.#gl.outputColorSpace = SRGBColorSpace;
    // No dynamic shadows anywhere in this project: the whole lighting model is
    // baked, so the shadow pipeline must never be paid for.
    this.#gl.shadowMap.enabled = false;
    this.#post = createPostPipeline(this.#gl);
    this.resize(
      frame ? frame.width : undefined, frame ? frame.height : undefined,
      tela ? tela.width : null, tela ? tela.height : null,
    );
    return this;
  }

  /**
   * The rectangle the world is drawn into, in CSS pixels.
   *
   * IT IS THE FRAMING'S AND NO LONGER THE WINDOW'S, and the default is left
   * here only for the one caller that has no framing yet: init(), which runs
   * before main.js has measured anything. Everything after that hands the
   * numbers in. See src/core/inquadratura.js.
   */
  resize(width = window.innerWidth, height = window.innerHeight,
    canvasWidth = null, canvasHeight = null) {
    this.#width = width;
    this.#height = height;
    // The canvas holds the picture plus the frame's margin, and it is the
    // picture wherever there is no frame. Kept so that setRenderScale() below
    // can put both back without the caller having to remember either.
    this.#canvasWidth = canvasWidth === null ? width : canvasWidth;
    this.#canvasHeight = canvasHeight === null ? height : canvasHeight;
    const ratio = this.pixelRatio;
    this.#gl.setPixelRatio(ratio);
    this.#gl.setSize(this.#canvasWidth, this.#canvasHeight, false);
    // The offscreen buffers are sized in real pixels, not in layout pixels —
    // and they are the PICTURE's, because that is where the world is drawn. The
    // only pass that ever sees the canvas is the composite, and it is told
    // where the picture sits in it by setCornice().
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
    this.resize(this.#width, this.#height, this.#canvasWidth, this.#canvasHeight);
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

  /** Where the picture stops and what is around it. See src/core/cornice.js. */
  setCornice(shape) { return this.#post.setCornice(shape); }

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

  /**
   * The driver's clock, and whether it is asked for the frame or for the stages.
   *
   * ELEVEN QUERIES ARE NOT ELEVEN TIMES ONE (U-PERF-7, E-LINUX1). The governor
   * reads one number, `total`; the eleven stages are read by the development
   * panel and by nothing else. Eleven timer queries are twenty two begin/end
   * calls and up to eleven SYNCHRONOUS reads a frame -- the one family of GL
   * call that a driver cannot queue, because it answers -- and on a browser
   * with no GL thread they are paid on the same thread that moves the body.
   * So `stages` is off unless somebody is looking.
   */
  setTiming(on, stages = false) { return this.#post.setTiming(on, stages); }

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
