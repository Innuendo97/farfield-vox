// Frame driver. Keeps a single requestAnimationFrame owner so update order is
// deterministic and instrumentation sees one authoritative frame time.

const MAX_DELTA = 0.1; // a tab regaining focus must not teleport the player

export class Loop {
  #handle = 0;
  #last = 0;
  #steps = [];

  add(fn) {
    this.#steps.push(fn);
    return this;
  }

  start() {
    this.#last = performance.now();
    const tick = (now) => {
      this.#handle = requestAnimationFrame(tick);
      const delta = Math.min((now - this.#last) / 1000, MAX_DELTA);
      this.#last = now;
      for (const step of this.#steps) step(delta, now);
    };
    this.#handle = requestAnimationFrame(tick);
    return this;
  }

  stop() {
    cancelAnimationFrame(this.#handle);
    this.#handle = 0;
  }
}
