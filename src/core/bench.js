import { BENCH_THRESHOLDS, DEFAULT_TIER, TIERS } from './quality.js';
import {
  bufferPixels, deviceRatio, FRACTIONS, frameOf, modelMs, PIXEL_CEILING, predictMs,
} from './inquadratura.js';

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
          tier: tierForLag(mid / interval),
          medianMs: mid,
          source: 'interval',
          // WHAT THE DISPLAY IS OFFERING, carried out with the reading rather
          // than thrown away with it. The framing is decided against a ceiling,
          // and on this branch the ceiling is not a number of milliseconds —
          // there are none to be had — it is a multiple of this. See
          // decideFraming() at the foot of this file.
          intervalMs: interval,
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

// ===========================================================================
// AND THE SECOND HALF OF THE VERDICT: HOW BIG THE PICTURE IS.
//
// The calibration has always answered one question — what can this machine
// afford — and given the answer as a TIER, which spends it on the scale, the
// grass and the halo. E-DECISIONI32 gave it a second lever to spend it on, and
// the committente put it FIRST in the order: «prima la scala fino a 0,85, poi
// l'area». So the policy below is not "shrink the picture until the frame is
// cheap"; it is "let the tiers do what they have always done down to the middle
// rung, and buy the rest with area rather than with softness".
//
// WHAT IT ACTUALLY ASKS. The bench reads the frame at the framing the page was
// built with, at the default tier. The model in src/core/inquadratura.js turns
// that one reading into a prediction for any other number of pixels. The
// largest framing whose predicted cost keeps this machine at the tier `medio`
// or better is the one it gets — and `medio` is where it stops because that is
// the last tier whose scale (0.85) the committente called acceptable: below it
// the texel of the ground and the engraved writing start paying, which is the
// thing area exists to avoid.
//
// AND IF EVEN THE FLOOR IS NOT ENOUGH, NOTHING DRAMATIC HAPPENS: the framing
// stays at six tenths and the tier ladder carries on downwards exactly as it
// did before any of this — `basso`, then `minimo`. A machine that cannot hold
// six tenths of its window is not given a smaller picture, it is given the
// cheaper world it was always given.
//
// THE TIER IS THEN READ OFF THE SAME PREDICTION, which is the one way to keep a
// single law: it is the number the bench WOULD have read had it measured the
// framing that was chosen. Nothing about tierForGpuMs or the thresholds moves.

/** The scale the policy prices against: the default tier's own. Read from the
 *  tier rather than written down, so a tier that is ever refitted cannot leave
 *  a second opinion about its own scale in here. */
const BENCH_SCALE = (TIERS.find((t) => t.id === DEFAULT_TIER) || { scale: 1 }).scale;

/** How far over the interval the display offers a machine with no timer query
 *  is allowed to sit before the area starts paying. It is LAG_THRESHOLDS.high:
 *  the line under which that branch calls a machine `alto`, which is the same
 *  place BENCH_THRESHOLDS.medium sits on the other branch — the edge of "this
 *  machine is keeping up". */
const LAG_CEILING = LAG_THRESHOLDS.high;

/**
 * The framing this verdict asks for, and the tier that goes with it.
 *
 * @param {object} verdict   what createBenchmark answered with
 * @param {object} where     the window it was answered in, and the buffer it
 *                           was read at: { width, height, ratio, benchPixels }
 * @returns {{fraction:number, tier:string, predictedMs:number, rungs:object[],
 *            reason:string}|null}
 */
export function decideFraming(verdict, where) {
  if (!verdict || !(verdict.medianMs > 0) || !(where.benchPixels > 0)) return null;
  const ratio = where.ratio ?? deviceRatio();
  const clocked = verdict.source === 'gpu';
  // On the lag branch the reading is an interval and the ceiling is a multiple
  // of the interval the display offers; on the clocked branch both are
  // milliseconds of GPU time. Either way what is compared are two numbers of
  // the same kind, which is the whole reason predictMs works on a ratio.
  const ceiling = clocked
    ? BENCH_THRESHOLDS.medium
    : LAG_CEILING * (verdict.intervalMs || verdict.medianMs);

  const rungs = FRACTIONS.map((fraction) => {
    const frame = frameOf(fraction, where.width, where.height);
    const pixels = bufferPixels(frame, ratio, BENCH_SCALE);
    return {
      fraction,
      frame,
      pixels,
      predictedMs: predictMs(verdict.medianMs, where.benchPixels, pixels),
      // A RUNG THE ABSOLUTE CEILING FORBIDS, and on this ladder there is at most
      // one of them: frameOf() already holds every framing below one under
      // PIXEL_CEILING, and one is the rung it deliberately leaves alone,
      // because one means "no framing at all". So this is where a 4K panel is
      // stopped from being handed its whole self by a machine fast enough to
      // ask for it.
      overCeiling: frame.width * frame.height > PIXEL_CEILING,
    };
  });

  const allowed = rungs.filter((rung) => !rung.overCeiling);
  const taken = allowed.find((rung) => rung.predictedMs < ceiling);
  const chosen = taken || allowed[allowed.length - 1] || rungs[rungs.length - 1];
  const tier = clocked
    ? tierForGpuMs(chosen.predictedMs)
    : tierForLag(chosen.predictedMs / (verdict.intervalMs || verdict.medianMs));

  return {
    fraction: chosen.fraction,
    frame: chosen.frame,
    pixels: chosen.pixels,
    predictedMs: chosen.predictedMs,
    tier,
    rungs,
    reason: taken ? 'sotto il tetto del banco' : 'pavimento',
  };
}

// ===========================================================================
// AND THE THIRD ANSWER: WHETHER THE NIGHT AROUND THE PICTURE TURNS.
//
// THE LINE IS THE COMMITTENTE'S AND IT HAS NOT MOVED: «animata se costa meno di
// 1 ms per fotogramma su quella macchina, altrimenti ferma con le sole stelle
// che brillano». What moved is the number the line is held against, because the
// instrument that produced the old one does not answer.
//
// WHAT IT USED TO SAY, AND WHY IT WAS WRONG (U-INQUADRATURA-1, §B.3). The night
// is not GL -- it is a bitmap on the COMPOSITOR, two radii on a side, turning
// rigidly about the pole. It was weighed by opening one page per arm, three
// rounds, and taking the median of the three:
//
//     braccio     intervallo medio   orologio del driver
//     nessuna          12.156              11.176
//     ferma            12.013              11.133
//     animata          13.271              12.615
//
// That put the turning sky at 1.12 ms, over the ceiling, and the world shipped
// with a still one. Re-run on the same desk with the same code, that bench now
// disagrees with ITSELF by up to 9.09 ms between three rounds of one arm -- it
// even puts a night with ONE COMPOSITOR LAYER FEWER above its own null. Its
// spread is not the sky, it is the drift between two page loads forty seconds
// apart: a new world built each time while the GPU changes clock and the cache
// fills. See §A.4 of the verbale of U-INQUADRATURA-2.
//
// WHAT IT SAYS NOW, FROM AN INSTRUMENT THAT ANSWERS. Both arms live in ONE page
// and alternate sixteen times on the same stream of frames, so what drifts
// drifts across both together and the difference of the two medians is the
// difference of the two states and nothing else
// (per-il-committente/lav/2026-09-21-inquadratura-2-costo-ab.mjs, 1645 and 1612
// frames):
//
//     la tela che gira     intervallo medio   orologio del driver
//     non c'e'                 11.912               11.608
//     e' appesa                12.163               11.662
//     differenza               +0.25                +0.05
//
// A QUARTER OF A MILLISECOND, which is a quarter of the committente's line. So
// on the reference machine the sky TURNS, and the still one is what a machine
// four and a half times slower than this desk gets -- the exact arithmetic of
// that is under decideNight() below, where the factor lives.
//
// AND THE PAGE CANNOT ASK THIS QUESTION OF ITSELF, which is the part worth
// writing down, because it looks as though it should be able to. A visitor's
// page has exactly two clocks and NEITHER of them can see this layer:
//
//   THE INTERVAL is pinned by the vsync. At sixty a second it reads 16.7 ms
//   whatever is inside it, and it only starts moving once the machine is
//   already over budget -- at which point it is measuring the machine and not
//   the sky. The bench above only sees 0.25 ms because it is launched with
//   --disable-gpu-vsync, and there is no way for a page to ask its own browser
//   for that.
//
//   THE DRIVER'S CLOCK is what run() reads when it can (source: 'gpu'), and it
//   sees 0.05 of the 0.25 -- a fifth, which is under anything a three second
//   calibration could resolve. That is the same discovery from the other side:
//   most of what a compositor layer costs lands outside the world's own pass.
//
// So the number is measured HERE, once, on the reference, with an instrument
// that can unhook the vsync, and the page scales it by the one factor it has.
// WHAT THAT SCALING ASSUMES, declared: that a machine which draws this world
// n times slower also composites n times slower. It is the same ratio the
// framing is decided with, and it is WEAKER here than there -- the framing
// scales a cost of the world's own pass by a factor measured on the world's own
// pass, and this scales a compositor's cost by it. It is the only factor a page
// has, and a page that guessed instead would be spending a millisecond nobody
// counted on the machine least able to lend it.
const NIGHT_SPIN_MS = 0.25;
const NIGHT_CEILING_MS = 1;

/**
 * Whether this machine can afford a sky that turns.
 *
 * The same speed factor the framing is decided with: the cost above is the
 * reference machine's, and this machine is however many times faster or slower
 * than it the one bench reading says.
 *
 * ON THE BRANCH WITH NO TIMER QUERY THE ANSWER IS ALWAYS `ferma`, and that is a
 * declared refusal rather than a measurement. The reading there is an interval
 * and not a cost, so there is no factor to scale a millisecond by -- and a
 * machine with no timer query is, on every one this campaign has met, the slow
 * one (E-LINUX1). Guessing `animata` there would be spending a millisecond
 * nobody counted on the machine least able to lend it.
 *
 * WHAT THE NUMBERS COME TO, so that the two ends of this are visible in one
 * place. The reference machine's own factor is 0.89 and not one -- it reads a
 * median of 15.91 ms where the model puts that buffer at 17.89, which is the
 * declared residue §7.5.6 of U-INQUADRATURA-1: the calibration runs while the
 * world is still arriving and reads about a tenth under the settled frame. So
 * the sky there is predicted at 0.22 ms and turns with more than three quarters
 * of a millisecond to spare.
 *
 * The ceiling trips at a factor of exactly four, which on this scale is a
 * machine FOUR AND A HALF TIMES SLOWER than the desk this campaign is judged
 * on -- one that would read a median of 71.6 ms where this one reads 15.9.
 * Between sito-4 and here nothing about any machine changed: what changed is
 * that the number they are all compared against came from a bench that answers
 * (E-DECISIONI36, point 1).
 */
export function decideNight(verdict, benchPixels) {
  if (!verdict || verdict.source !== 'gpu' || !(benchPixels > 0)) return 'ferma';
  const factor = verdict.medianMs / modelMs(benchPixels);
  return NIGHT_SPIN_MS * factor < NIGHT_CEILING_MS ? 'animata' : 'ferma';
}

/**
 * AND WHAT TO DO WHEN THE CALIBRATION ANSWERS NOTHING AT ALL.
 *
 * THE DEFECT THIS ANSWERS, MEASURED (E-DECISIONI33, point 5). finish() above
 * throws the calibration away under forty readings, and on a large window it
 * never gets forty: the driver's timer query ring is twelve deep, a slow frame
 * takes longer than twelve frames to answer, the ring saturates, and almost
 * four thousand frames go past uncounted. Measured on a first visit: 134
 * readings on the reference window, TWO on a 3440x1440, ten on a 4K.
 *
 * What followed was the opposite of what this whole module is for. No verdict
 * meant no tier, NO FRAMING, and no stored answer — so the page sat at the
 * default tier on the whole of a 4.95 or 8.29 megapixel window, the governor
 * watched it run hot and walked it down, and the ultrawide ended at `minimo`
 * with every pixel of the window still being drawn. The visitor the framing
 * exists for was the one visitor who never got one.
 *
 * WHAT THIS DOES INSTEAD, AND WHAT IT REFUSES TO DO. It answers the only
 * question that can still be answered when the machine would not say anything:
 * HOW BIG IS THE WINDOW. The model is the reference machine's own line, so what
 * comes back is the framing the REFERENCE machine would need for this window —
 * a stand-in, not a measurement, and it is used for the framing alone.
 *
 * IT NAMES NO TIER. The tier ladder is not this unit's to move and a machine
 * that said nothing has said nothing about which tier it can hold; the default
 * stands and the governor goes on doing its job. What changes is that it does
 * its job over a frame that fits.
 *
 * AND IT IS REMEMBERED, which is the part that heals. The next visit starts at
 * that framing, so the frame the calibration is asked to time is the smaller
 * one — and a smaller frame is exactly what the query ring needs in order to
 * keep up. A machine that could not answer is handed the conditions in which it
 * can.
 */
export function framingFromWindowAlone(where) {
  const ratio = where.ratio ?? deviceRatio();
  const ceiling = where.ceilingMs ?? BENCH_THRESHOLDS.medium;
  const rungs = FRACTIONS.map((fraction) => {
    const frame = frameOf(fraction, where.width, where.height);
    return {
      fraction,
      frame,
      pixels: bufferPixels(frame, ratio, BENCH_SCALE),
      overCeiling: frame.width * frame.height > PIXEL_CEILING,
    };
  }).map((rung) => ({ ...rung, predictedMs: modelMs(rung.pixels) }));

  const allowed = rungs.filter((rung) => !rung.overCeiling);
  const taken = allowed.find((rung) => rung.predictedMs < ceiling);
  const chosen = taken || allowed[allowed.length - 1] || rungs[rungs.length - 1];
  return {
    fraction: chosen.fraction,
    frame: chosen.frame,
    pixels: chosen.pixels,
    predictedMs: chosen.predictedMs,
    rungs,
    reason: taken ? 'la finestra sola, sotto il tetto del banco' : 'la finestra sola, pavimento',
  };
}
