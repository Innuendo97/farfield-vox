// Development instrumentation, enabled only with the ?dev query flag.
// Frame time is averaged over a fixed window so the reading is stable enough to
// compare between deliveries; the raw per-frame value is far too noisy.

const WINDOW = 60;

// WHAT ELSE GOES ON THE PANEL, AND WHO PUTS IT THERE.
//
// Every session is going to want a line of its own -- how many chunks the disc
// has landed, how many courses the masonry cut, how many lamps the night is
// drawing -- and the panel is one file. Eight sessions each adding a line to
// one render function is eight conflicts in a file none of them owns, resolved
// by whoever rebases last.
//
// So a layer registers instead. It hands over a name and a function; the
// function is given the same `extra` the panel is given and answers with a line,
// or with nothing at all when it has nothing to say. Registering twice under one
// name replaces rather than duplicates, so a module reloaded by the dev server
// cannot stack copies of its own row.
//
// The keys are the same problem and get the same answer: the legend at the foot
// of the panel is one string that every session wants to append to.
const ROWS = new Map();
const KEYS = new Map();

/**
 * @param {string} id      the layer's own id, so a reader knows whose row it is
 * @param {Function} render given `extra`, answers with a string, an array of
 *                          strings, or null for "nothing to say this frame"
 */
export function addHudRow(id, render) {
  ROWS.set(id, render);
}

/** One entry in the legend at the foot of the panel, e.g. "[N] notte". */
export function addHudKey(id, legend) {
  KEYS.set(id, legend);
}

export function isDevMode() {
  return new URLSearchParams(window.location.search).has('dev');
}

/**
 * Whether the development flags ask for a still world: ?dev&t0.
 *
 * What it holds is the weather's own clock, at exactly nought. Every comparison
 * against the reference is a comparison against one instant, and the instant the
 * sky was measured at is the one the walker arrives on: with this flag that
 * instant can be photographed as many times as a comparison needs.
 */
export function isClockFrozen() {
  const query = new URLSearchParams(window.location.search);
  return query.has('dev') && query.has('t0');
}

export function createDevHud(root) {
  const el = document.createElement('div');
  el.className = 'dev-hud';
  root.appendChild(el);

  const samples = new Float32Array(WINDOW);
  let index = 0;
  let filled = 0;
  let repaintAt = 0;

  return {
    update(deltaSeconds, now, stats, extra = {}) {
      samples[index] = deltaSeconds * 1000;
      index = (index + 1) % WINDOW;
      if (filled < WINDOW) filled++;

      if (now - repaintAt < 200) return;
      repaintAt = now;

      let total = 0;
      let worst = 0;
      for (let i = 0; i < filled; i++) {
        total += samples[i];
        if (samples[i] > worst) worst = samples[i];
      }
      const mean = total / filled;

      const quality = extra.quality ?? null;
      const renderer = extra.renderer ?? null;
      const stages = extra.stages ?? null;
      const grass = extra.grass ?? null;
      const ms = (value) => (typeof value === 'number' ? `${value.toFixed(2)} ms` : '--');
      const buffer = renderer ? renderer.drawingBuffer() : null;

      const lines = [
        `fps      ${(1000 / mean).toFixed(1)}`,
        `frame    ${mean.toFixed(2)} ms`,
        `worst    ${worst.toFixed(2)} ms`,
        `cpu      ${(extra.cpuMs ?? 0).toFixed(2)} ms`,
      ];

      if (quality) {
        const pending = quality.pending ? ` -> ${quality.pending.id}` : '';
        lines.push(
          `tier     ${quality.tier.id}${pending} (${quality.automatic ? 'auto' : 'scelto'})`,
          `gpu      ${ms(extra.gpuMs)}`,
          `gpu med  ${ms(quality.medianMs)}   p95 ${ms(quality.p95Ms)}`,
        );
      }
      // Only where the driver hands out a clock; everywhere else the frame is
      // one number and pretending otherwise would be inventing three.
      if (stages) {
        if (stages.prepass) lines.push(`  volume ${ms(stages.prepass)}`);
        lines.push(
          `  mondo  ${ms(stages.scene)}`,
          `  bloom  ${ms(stages.bloom)}`,
          `  comp   ${ms(stages.composite)}`,
        );
      }

      lines.push(
        `draw     ${stats.drawCalls}`,
        `tris     ${stats.triangles}`,
        `geom/tex ${stats.geometries}/${stats.textures}`,
      );

      if (buffer) {
        lines.push(`scala    ${renderer.renderScale.toFixed(2)}  ${buffer.width}x${buffer.height}`);
      }
      // READ DEFENSIVELY, for the reason the layer rows below are wrapped in a
      // try: this block used to name four fields of the vegetation's stats
      // outright, and when V4 retired the far ring and the horizon lever with
      // the mass they were thinning, it threw here once a frame and took the
      // whole panel down -- in the one place a session goes to find out what is
      // wrong. A diagnostic may report a missing number; it may not die of one.
      if (grass && grass.grass) {
        const flowers = grass.flowers ? ` + ${grass.flowers.placed} fiori` : '';
        lines.push(
          `verde    ${grass.grass.placed} ciuffi${flowers}`,
          `         densita ${grass.density.toFixed(2)} raggio ${grass.radius.toFixed(0)} m`
            + (grass.perSquareMetre == null ? '' : `  ${grass.perSquareMetre.toFixed(3)}/m2`),
        );
      }

      // What the layers have to say, in the order they registered. A row that
      // throws is a row that would take the whole panel down with it, and a
      // panel is a diagnostic: it must never be the reason a session cannot see
      // what is wrong.
      for (const [id, render] of ROWS) {
        let out = null;
        try {
          out = render(extra);
        } catch (error) {
          out = `${id.padEnd(8)} ${error.message}`;
        }
        if (out) lines.push(...(Array.isArray(out) ? out : [out]));
      }

      lines.push(
        `pos      ${extra.position ?? ''}`,
        `speed    ${extra.speed ?? ''}`,
        `buffer   ${extra.buffer ?? ''}`,
        ['[P] posa  [G] stadi  [V] erba  [B] calibra', ...KEYS.values()].join('  '),
      );

      el.textContent = lines.join('\n');
    },
  };
}

// Grading controls. The values that decide how the frame looks are the ones
// that get argued over against the reference image, so they are adjustable
// while walking, and each stage of the composite can be switched off on its own
// to see what it is actually contributing.
const CONTROLS = [
  { key: 'exposure', label: 'esposizione', min: 0.2, max: 3, step: 0.02 },
  { key: 'bloomStrength', label: 'bloom', min: 0, max: 0.6, step: 0.005 },
  { key: 'bloomThreshold', label: 'soglia bloom', min: 0.2, max: 4, step: 0.05 },
  { key: 'lutIntensity', label: 'intensita cielo', min: 0, max: 1, step: 0.02 },
  // The scene's half of the grade. The vignette used to be here; it is not a
  // grading control any more because it is not in the composite any more — the
  // corner shading of this picture is one measured table in src/ui/veil.js.
  { key: 'sceneAmount', label: 'grado scena', min: 0, max: 1.5, step: 0.02 },
  { key: 'sceneGain', label: 'contrasto scena', min: 0.6, max: 2.4, step: 0.01 },
  { key: 'scenePivot', label: 'perno scena', min: 0.1, max: 0.8, step: 0.01 },
  { key: 'sceneBlack', label: 'nero scena', min: 0, max: 0.25, step: 0.005 },
  { key: 'shadowRange', label: 'ombra fin dove', min: 0, max: 0.8, step: 0.01 },
];

// Only the geometry is set from here; the frame and the colours come from the
// .dev-panel rule, which exists so a comparison run can hide every development
// panel at once and photograph the interface that ships.
const PANEL_STYLE = 'top:12px;left:12px;padding:10px 12px;width:250px;font-size:11px;line-height:1.5;';
const ROW_STYLE = 'display:grid;grid-template-columns:84px 1fr 34px;align-items:center;gap:6px;';

export function createGradePanel(root, post) {
  const el = document.createElement('div');
  el.className = 'dev-panel';
  el.setAttribute('style', PANEL_STYLE);
  root.appendChild(el);

  const status = document.createElement('div');
  status.setAttribute('style', 'margin-bottom:6px;opacity:0.85;');
  el.appendChild(status);

  for (const control of CONTROLS) {
    const row = document.createElement('label');
    row.setAttribute('style', ROW_STYLE);
    const name = document.createElement('span');
    const value = document.createElement('b');
    const slider = document.createElement('input');
    slider.setAttribute('style', 'width:100%;');
    slider.type = 'range';
    slider.min = control.min;
    slider.max = control.max;
    slider.step = control.step;
    slider.value = post.params[control.key];
    name.textContent = control.label;
    value.textContent = Number(slider.value).toFixed(2);
    slider.addEventListener('input', () => {
      post.params[control.key] = Number(slider.value);
      value.textContent = Number(slider.value).toFixed(2);
    });
    row.append(name, slider, value);
    el.appendChild(row);
  }

  let cursor = -1;
  const repaint = () => {
    const off = post.stageOrder.filter((key) => !post.stages[key]);
    status.textContent = off.length === 0 ? 'tutti gli stadi attivi' : `spento: ${off.join(', ')}`;
  };
  repaint();

  return {
    // One key walks through the stages, turning each off in turn and then all
    // back on, which is the quickest way to answer "what is that doing".
    cycleStage() {
      if (cursor >= 0) post.stages[post.stageOrder[cursor]] = true;
      cursor += 1;
      if (cursor >= post.stageOrder.length) cursor = -1;
      else post.stages[post.stageOrder[cursor]] = false;
      repaint();
    },
  };
}
