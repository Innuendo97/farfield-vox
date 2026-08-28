// Development instrumentation, enabled only with the ?dev query flag.
// Frame time is averaged over a fixed window so the reading is stable enough to
// compare between deliveries; the raw per-frame value is far too noisy.

const WINDOW = 60;

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
      if (grass) {
        lines.push(
          `erba     ${grass.grass.placed}+${grass.far.placed} carte`,
          `         densita ${grass.density.toFixed(2)} raggio ${grass.radius.toFixed(0)} m`
            + ` orizz ${grass.horizon.toFixed(2)}`,
        );
      }

      lines.push(
        `pos      ${extra.position ?? ''}`,
        `speed    ${extra.speed ?? ''}`,
        `buffer   ${extra.buffer ?? ''}`,
        '[P] posa  [G] stadi  [V] erba  [B] calibra',
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
