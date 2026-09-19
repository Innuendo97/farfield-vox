import { BENCH_THRESHOLDS, TIERS } from './quality.js';

// The three seconds in which the machine is asked what it can do.
//
// It happens once, on the first visit, behind the prompt the walker has not
// clicked yet: the world is already drawn and already walkable, the eye turns
// slowly across the whole hub on its own, and what comes back is the median
// cost of a frame. That number picks the tier. Afterwards the answer is
// remembered, because the machine is not going to change between two visits
// and three seconds of turning is three seconds nobody asked for.
//
// It is measured with the driver's own clock where there is one. Where there is
// not, the only thing the main thread can see is the interval between two
// frames, and on a machine that is keeping up that interval is the refresh rate
// and says nothing about how much room is left. So the fallback does not read
// milliseconds at all: it reads how far the frame has fallen behind the
// interval the display is offering, which is the one thing that interval can
// still answer. It cannot recognise a machine with room to spare — only one
// that has run out — and it never reaches for the highest tier because of it.

// Frames thrown away before anything is counted. The first pass over this scene
// compiles every program in it and uploads what has not been touched yet, and
// none of that is what a frame costs.
const WARMUP_FRAMES = 30;

const DURATION_MS = 3000;

// How far the eye is carried, in degrees. NOUGHT -- the eye is HELD on the
// framing the world was fitted against, and the calibration measures what is in
// front of it (D-R8-1, option B, the committente's own).
//
// It was half a turn, and the reason was a good one: a sweep crosses the five
// blocks, the water, both lakes and the open meadow, which between them are
// every kind of surface there is, so the median it returns is a median of the
// WORLD. What it cost is the thing R8 caught on the arrival: for three seconds
// and a warm-up -- 8.3 degrees over 7.3 seconds, measured -- the visitor's own
// eye is turned by nobody's hand, during the very seconds when the meadow, the
// flowers and the weather are still arriving. «Tre secondi di sguardo che gira
// che nessuno ha chiesto». The first thing this world does to a visitor cannot
// be to take their head.
//
// WHAT IT COSTS, DECLARED: fewer surfaces in the sample, so the median is of the
// arrival framing rather than of the whole world, and the tier it reports is a
// touch optimistic wherever the arrival framing happens to be cheaper than the
// mean of the world. It is measured both ways in the verbale rather than
// guessed at, and the thresholds are left where they are until it is.
const SWEEP_DEGREES = 0;

// Where the fallback puts its lines, as a multiple of the interval the display
// is offering. Under a sixth over is a machine keeping up; past three fifths
// over is a machine that has already halved its frame rate.
// AND THE LOWEST OF THEM IS THE ONE THE COMMITTENTE'S OWN LAPTOP SET
// (E-LINUX1). Firefox on X11 has no timer query to offer, so that machine falls
// down this branch and nowhere else: it reads 42,5 ms of frame against a
// 16,7 ms display interval at the tier BASSO, which is 2,54. Past 2,4 the
// machine has not merely lost a tier, it has lost more than half its frames,
// and the tier under `basso` is the only answer left that is not a stutter.
const LAG_THRESHOLDS = { high: 1.15, medium: 1.6, low: 2.4 };

const NOTE_STYLE = [
  'position:absolute',
  'left:50%',
  'bottom:14%',
  'transform:translateX(-50%)',
  'font-size:0.72rem',
  'font-weight:300',
  'letter-spacing:0.28em',
  'text-transform:uppercase',
  'color:var(--ui-ink-soft)',
  'text-shadow:var(--ui-shadow)',
  'opacity:0',
  'transition:opacity 420ms ease',
  'pointer-events:none',
].join(';');

function smootherstep(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

function quantile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

/** Which tier a reading of the driver's clock asks for. */
export function tierForGpuMs(ms) {
  if (ms < BENCH_THRESHOLDS.discrete) return 'oltre';
  if (ms < BENCH_THRESHOLDS.high) return 'alto';
  if (ms < BENCH_THRESHOLDS.medium) return 'medio';
  if (ms < BENCH_THRESHOLDS.low) return 'basso';
  return 'minimo';
}

/** And which one an interval that is only ever the refresh rate asks for. */
export function tierForLag(ratio) {
  if (ratio < LAG_THRESHOLDS.high) return 'alto';
  if (ratio < LAG_THRESHOLDS.medium) return 'medio';
  if (ratio < LAG_THRESHOLDS.low) return 'basso';
  return 'minimo';
}

/**
 * The calibration.
 *
 * @param {object} parts  the renderer facade, the pose the sweep starts from,
 *                        and the layer the note is written on
 */
export function createBenchmark({ renderer, pose, ui }) {
  const note = document.createElement('p');
  note.className = 'bench-note';
  note.setAttribute('style', NOTE_STYLE);
  note.setAttribute('role', 'status');
  note.textContent = 'Calibrazione';
  ui.appendChild(note);

  let state = 'idle';   // idle | warmup | running
  let warmed = 0;
  let elapsed = 0;
  let samples = [];
  let resolve = null;
  // The body the sweep is turning, so it can be put back. The eye is borrowed
  // for three seconds and has to be returned where it was found: a walker who
  // clicks to explore and arrives facing away from the whole hub has been
  // handed a different world from the one the framing promises.
  let body = null;

  function finish(reason) {
    if (body) body.setPose(pose);
    body = null;
    const clocked = renderer.hasGpuClock;
    const mid = median(samples);
    let verdict = null;

    if (mid !== null && samples.length >= 40) {
      if (clocked) {
        verdict = { tier: tierForGpuMs(mid), medianMs: mid, source: 'gpu' };
      } else {
        // The shortest intervals are the ones the display imposed rather than
        // the frame, so they are the interval itself.
        const interval = quantile(samples, 0.1) || mid;
        verdict = {
          tier: tierForLag(mid / interval), medianMs: mid, source: 'interval',
        };
      }
      verdict.p95Ms = quantile(samples, 0.95);
      verdict.frames = samples.length;
      verdict.reason = reason;
    }

    state = 'idle';
    samples = [];
    note.style.opacity = '0';
    const settle = resolve;
    resolve = null;
    if (settle) settle(verdict);
  }

  return {
    get active() { return state !== 'idle'; },

    /** Runs the sweep, and answers with a tier or with null if it was cut short. */
    run() {
      if (state !== 'idle') return Promise.resolve(null);
      state = 'warmup';
      warmed = 0;
      elapsed = 0;
      samples = [];
      note.style.opacity = '0.72';
      return new Promise((settle) => { resolve = settle; });
    },

    /** Gives the frame back to the walker with whatever has been gathered. */
    stop() {
      if (state !== 'idle') finish('interrupted');
    },

    /**
     * One frame of the sweep: turns the eye and counts what the turn cost.
     *
     * @param {number} delta   seconds since the last frame
     * @param {number} cost    the driver's reading, or the interval in its place
     * @param {object} player  the body, which is stood still and only turned
     */
    step(delta, cost, player) {
      if (state === 'idle') return;
      body = player;
      if (state === 'warmup') {
        player.setPose(pose);
        warmed++;
        if (warmed >= WARMUP_FRAMES) state = 'running';
        return;
      }

      elapsed += delta * 1000;
      const t = Math.min(1, elapsed / DURATION_MS);
      // Eased at both ends, so the sweep starts and stops without a jerk and
      // spends most of its time at one rate.
      player.setPose({ ...pose, yaw: pose.yaw + SWEEP_DEGREES * smootherstep(t) });

      if (Number.isFinite(cost) && cost > 0) samples.push(cost);
      if (t >= 1) finish('complete');
    },

    dispose() { note.remove(); },
  };
}

/** The tier a verdict names, or null if it names none. */
export function tierOf(verdict) {
  if (!verdict) return null;
  return TIERS.some((tier) => tier.id === verdict.tier) ? verdict.tier : null;
}
