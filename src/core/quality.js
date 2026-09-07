// What the frame is allowed to cost on this machine, and what is given up to
// keep it there.
//
// There is one rule above every number below: the identity of the picture is
// never a tier. The sky, the baked light, the tone curve with the fitted grade
// and its vignette, the air, and everything that glows are the same on every
// machine — a slower one gets the same world drawn over fewer pixels with less
// grass in it, never a different world. Everything that may be spent is in
// LEVERS, in the order it is spent, and the order is not arbitrary: it runs
// from what changes nothing about what is in the frame to what changes what is
// in it, so the first thing to go is always the least visible thing left.
//
//   1  resolution      the same frame over fewer pixels
//   2  grass           the only thing here drawn in real time, and the only
//                      thing whose cost grows with where the eye is pointed
//   3  bloom           a coarser halo, never no halo
//   4  multisampling   two samples on every tier (E-DECISIONI14)
//
// Two more were named and are not taken, for the same reason: they are worth
// nothing here. Anisotropy in this world is set on exactly two surfaces, the
// engraved writing and the open panels, both flat and both read close to head
// on, where the sampler asks for one tap whatever it is allowed. And there is
// no level of detail to drop on the rocks or the bushes, because there is no
// chain to drop it from: they are baked stone and single cards, and the frame
// spends its time filling the meadow, not submitting them.
//
// ------------------------------------------------------------------------
// THE LEVERS THE SESSIONS WILL PULL. THE FIRST OF THEM IS NOW LIVE.
//
// They were declared here neutral, with nothing reading them, so that adding a
// lever would not be an edit to this file by whichever session got there first
// — a governor is exactly the sort of shared file where two sessions each add a
// field, each rebase, and the second one silently wins.
//
//   voxelDiscRadius   V1   how far the ten centimetre ground reaches, in metres
//                          — READ, and no longer neutral. See below.
//   grassDensity      V4   already here, as grass.density; named for the record
//   cloudsDetail      V6   how much of the weather is drawn
//   nightGlow         V7   how much of the night's halo is afforded
//
// WHERE THEY SIT IN THE ORDER is the session's to argue and the coordinator's
// to settle, and it is NOT arbitrary — the rule at the top of this file is that
// the first thing to go is the least visible thing left. A voxel disc that
// shrinks with the tier changes what the ground under the walker IS, so it
// stands below the grass and not above it; a night that dims changes the
// picture itself, so on the face of it it does not belong in this list at all.
// Both are for the sessions that own them to measure.
//
// ------------------------------------------------------------------------
// voxelDiscRadius: WHERE THESE FOUR NUMBERS COME FROM.
//
// Measured, at the frame the recipe is judged at, with the frozen engine
// reproducing the page's own triangle count digit for digit on seven poses.
// Triangles SUBMITTED TO THE BUFFER at vox-giorno, on the carpet the
// committente chose (E-DECISIONI.1):
//
//     r = 10 m     85 412 tri     0.97x of the reallocated 88k
//     r = 12 m    119 614         1.36x
//     r = 14 m    151 470         1.72x   <- the arm that was priced and chosen
//     r = 16 m    182 502         2.07x
//     r = 35 m    500 610         5.69x
//
// SO FOURTEEN IS NOT A COMPROMISE, IT IS THE PRICE THAT WAS AGREED. The
// committente was shown three arms and chose the one D3a priced at 1.73x; the
// page draws it at 1.72x. Any tier above fourteen spends budget nobody granted,
// which is E-V5i's rule, so the top two tiers do not get more reach — they get
// the same world. `oltre` has nothing to spend here, and that is written down
// rather than filled in: sixteen metres is measured and ready at 2.07x the day
// the coordinator grants the headroom.
//
// AND E-V1a's THIRTY FIVE CANNOT BE HAD WITH THIS CARPET. Not by a margin that
// tuning closes: 5.69x. The two decisions — the reach and the carpet — are the
// same budget spent twice, and the committente's word bought the carpet. The
// engine's default stays thirty five because that is what E-V1a settled and
// what a reach argument should be re-opened against; what SHIPS is the tier.
//
// `basso` drops to twelve, which is the lever doing the only job it has: a
// machine that cannot hold the agreed world gets less ground rather than a
// different one. The disc is read ONCE, when the ground is built, so a tier
// that moves later reaches everything else and leaves the ground the size it
// was — see hub.setVoxelDiscRadius.
// ------------------------------------------------------------------------

// AND THE PIXEL OF THE SCENE BUFFER IS THE SAME ON EVERY TIER, which is the one
// lever here that is NOT a tier's to spend. A tier may draw fewer pixels and
// resolve fewer samples of them; what it may not do is hold a different range of
// light, because the bloom's threshold, the exposure and both grades are fitted
// against the numbers in this buffer and a tier that carried a different range
// would be a second opinion about the hour. Four bytes of packed float carry the
// same range the half float did -- the sun's disc stands at a hundred in these
// units -- at half the bandwidth, and the half float is the rung below it for a
// driver that has no packed float. Measured on the reference machine, tier alto,
// median of the frame over 336 frames, six poses: 22.4 -> 16.8 ms at pose P and
// 28.9 -> 24.0 at the worst pose in the world.
export const TIERS = [
  {
    id: 'oltre',
    label: 'Oltre',
    // Reached only by the benchmark, and only on a machine that draws the
    // reference framing in under five milliseconds. It is the same world with
    // more of the one thing that was rationed for the machines that cannot:
    // never a feature the other tiers do not have.
    scale: 1,
    // TWO SAMPLES ON EVERY TIER, AND IT IS THE COMMITTENTE'S OWN DECISION
    // (E-DECISIONI14: «anti-aliasing: la raccomandazione», which is two samples
    // on the borders of the cubes). Multisampling is charged per TRIANGLE EDGE,
    // and the ground stopped being made of edges: the meadow is a ray-marched
    // field now, so four samples bought 1.39 ms of softness on the box's own
    // borders where they used to buy 3.75 ms of it on 172 608 triangles of
    // blade. What is left for them to antialias is the masonry and the
    // flowers, and two is what the low tier has always shipped.
    samples: 2,
    sceneFormat: 'R11F_G11F_B10F',
    bloom: 'half',
    grass: { density: 1.3, radius: 16 },
    // Owners in brackets, so a reader knows whose number this is before
    // touching it. The disc's reach is measured: see the block over TIERS.
    voxelDiscRadius: 14,   // [V1] metres of ten centimetre ground from the centre
    // HOW FINELY THE GROUND IS RESOLVED, AND IT IS NOW IN METRES FROM THE
    // WALKER AND NOT IN PIXELS ON THE SCREEN.
    //
    // `near` is the radius of the ring inside which the mat is drawn whole, at
    // five centimetres -- the committente's «cubi veri dove si guarda» -- and
    // `step` is the factor between one front and the next after it. A pixel
    // rule (what this was: a cell had to cover N pixels) moves the fronts with
    // the field of view, so the same meadow from the same place redrew itself
    // at another cell size whenever the walker zoomed -- measured at 1.83x
    // between fov 44.2 and 25 -- and it moved them with a head that turned.
    // Neither is true of a distance in metres.
    //
    // THE CONSTRAINT IS THE NEAR WINDOW: near * step^2 <= 19.2 m, because past
    // that there is no picture finer than forty centimetres and a law that
    // wanted level two out there would make a ring that jumps with the window
    // (8.2% of the ground in one step, measured). The fronts here are
    // 9 / 13.05 / 18.92 m at the top, 6 / 10.5 / 18.4 in the middle, and
    // 4.5 / 9 / 18 at the bottom: a tier buys its milliseconds by pulling the
    // RING in, which is fewer samples of the same world and never another one.
    // Priced on the card at the pose the campaign judges on: nine metres costs
    // +3.4 to +4.5 ms over the pixel rule, six +3.9, twelve +8 to +15.
    //
    // `lag` is the width of the BAND, in milliseconds: the fragment is handed
    // where the walker was that long ago and where they are now, and each pixel
    // picks a point between the two by its own hash, so a front of detail is a
    // grain as wide as the walker covers in that time rather than a line that
    // jumps. Standing still, after the lag, the frame is identical to the byte.
    // It replaces `snap`, the hysteresis in metres, which is what a band has no
    // need of -- a step taken and taken back moves the grain there and back with
    // it and changes no cell twice. See createCampo().setDetail in
    // src/world/voxel/campo-field.js, and the note over lodMode beside it.
    //
    // WHY THE SLOWER TIER GETS A WIDER ONE. The band is spread over the frames
    // that fall inside it: at 30 frames a second 300 ms is nine of them and the
    // grain is fine, at 18 it is five and it starts to read as steps. The
    // bottom tier buys back the frames it does not have with a wider band.
    groundDetail: { near: 9, step: 1.45, lag: 300 },     // [V1] the ring in metres, the band in ms
    campoScale: 0.75,     // [U-CAMPO-3] la frazione di lato: vedi la nota al tier alto
    cloudsDetail: 1,       // [V6] how much of the weather is drawn
    nightGlow: 1,          // [V7] how much of the night's halo is afforded
  },
  {
    id: 'alto',
    label: 'Alta',
    scale: 1,
    // TWO SAMPLES ON EVERY TIER, AND IT IS THE COMMITTENTE'S OWN DECISION
    // (E-DECISIONI14: «anti-aliasing: la raccomandazione», which is two samples
    // on the borders of the cubes). Multisampling is charged per TRIANGLE EDGE,
    // and the ground stopped being made of edges: the meadow is a ray-marched
    // field now, so four samples bought 1.39 ms of softness on the box's own
    // borders where they used to buy 3.75 ms of it on 172 608 triangles of
    // blade. What is left for them to antialias is the masonry and the
    // flowers, and two is what the low tier has always shipped.
    samples: 2,
    sceneFormat: 'R11F_G11F_B10F',
    bloom: 'half',
    grass: { density: 1, radius: 12 },
    // Owners in brackets, so a reader knows whose number this is before
    // touching it. The disc's reach is measured: see the block over TIERS.
    voxelDiscRadius: 14,   // [V1] metres of ten centimetre ground from the centre
    groundDetail: { near: 9, step: 1.45, lag: 300 },     // [V1] the ring in metres, the band in ms
    // [U-CAMPO-3] LA FRAZIONE DI LATO A CUI LA TERRA E' MARCIATA, e i due
    // numeri di questa riga sono l'unica cosa che questa unita' abbia deciso
    // per conto di chi guarda.
    //
    // TRE QUARTI IN ALTO, MEZZO SOTTO. A quattro volte la grandezza naturale,
    // affiancato al nativo, il prato VICINO a mezzo lato si vede diverso -- i
    // grumi di terra del sentiero ai piedi diventano piu' grossi -- e a tre
    // quarti no. E' esattamente il criterio che il coordinatore ha posto, e la
    // lastra 2026-09-08-campo-3-ritagli-4x.png e' dove si e' guardato. Il costo
    // del tre quarti e' 47% del disegno nativo della terra contro il 24% del
    // mezzo (misurato per DISEGNO, orologio del driver), e sui numeri di
    // E-PERF5 quello mette la posa P a 17,6 p50 e 22,1 p95: il cancello dei 22
    // ms preso, con la scritta del monolite intatta -- che e' precisamente cio'
    // che la leva del FOTOGRAMMA a 0,85 non poteva dare (E-PERF5 §6.1: stesso
    // p95, e «la scritta del monolite si ammorbidisce col prato»).
    //
    // E SOTTO SI SCENDE A MEZZO PERCHE' LI' IL QUADRO E' GIA' RIDOTTO. Il tier
    // medio disegna a 0,85 di lato e il basso a 0,75: il prato vicino e' gia'
    // piu' morbido di quello a cui il confronto a quattro volte e' stato fatto,
    // e cio' che quel confronto separa non si separa piu'. Quel che si compra
    // e' il cancello, che e' l'unica ragione per cui quei due tier esistono.
    campoScale: 0.75,
    cloudsDetail: 1,       // [V6] how much of the weather is drawn
    nightGlow: 1,          // [V7] how much of the night's halo is afforded
  },
  {
    id: 'medio',
    label: 'Media',
    scale: 0.85,
    // TWO SAMPLES ON EVERY TIER, AND IT IS THE COMMITTENTE'S OWN DECISION
    // (E-DECISIONI14: «anti-aliasing: la raccomandazione», which is two samples
    // on the borders of the cubes). Multisampling is charged per TRIANGLE EDGE,
    // and the ground stopped being made of edges: the meadow is a ray-marched
    // field now, so four samples bought 1.39 ms of softness on the box's own
    // borders where they used to buy 3.75 ms of it on 172 608 triangles of
    // blade. What is left for them to antialias is the masonry and the
    // flowers, and two is what the low tier has always shipped.
    samples: 2,
    sceneFormat: 'R11F_G11F_B10F',
    bloom: 'quarter',
    grass: { density: 0.7, radius: 12 },
    // Owners in brackets, so a reader knows whose number this is before
    // touching it. The disc's reach is measured: see the block over TIERS.
    voxelDiscRadius: 14,   // [V1] metres of ten centimetre ground from the centre
    groundDetail: { near: 6, step: 1.75, lag: 300 },     // [V1] the ring in metres, the band in ms
    campoScale: 0.5,       // [U-CAMPO-3] la frazione di lato: vedi la nota al tier alto
    cloudsDetail: 1,       // [V6] how much of the weather is drawn
    nightGlow: 1,          // [V7] how much of the night's halo is afforded
  },
  {
    id: 'basso',
    label: 'Bassa',
    scale: 0.75,
    samples: 2,
    sceneFormat: 'R11F_G11F_B10F',
    bloom: 'quarter',
    grass: { density: 0.4, radius: 12 },
    // Owners in brackets, so a reader knows whose number this is before
    // touching it. TWELVE and not fourteen: the only lever this tier has on the
    // ground is how much of it there is. 119 614 triangles against 151 470.
    voxelDiscRadius: 12,   // [V1] metres of ten centimetre ground from the centre
    groundDetail: { near: 4.5, step: 2, lag: 400 },      // [V1] the ring in metres, the band in ms
    campoScale: 0.5,       // [U-CAMPO-3] la frazione di lato: vedi la nota al tier alto
    cloudsDetail: 1,       // [V6] how much of the weather is drawn
    nightGlow: 1,          // [V7] how much of the night's halo is afforded
  },
];

// What the walker may ask for by hand. The best tier is not among them: it is
// an answer about a machine, not a preference, and offering it on a machine
// that cannot hold it would be offering a stutter.
export const CHOICES = ['auto', 'alta', 'media', 'bassa'];

const CHOICE_TIER = { alta: 'alto', media: 'medio', bassa: 'basso' };

export const DEFAULT_TIER = 'medio';

// Where the benchmark puts the line, in milliseconds of GPU time at the median.
// The budget for a frame on the target hardware is between eight and twelve
// milliseconds; these sit just inside it, so a machine that lands on a boundary
// is given the tier it can hold rather than the one it can just reach.
export const BENCH_THRESHOLDS = { high: 9, medium: 13, discrete: 5 };

// The governor.
//
// A median over ninety frames is what is watched, because a single frame says
// nothing: a texture upload, a lattice refill or another window waking up all
// cost more than the frame does. Coming down is quick and going up is slow and
// both are far apart, so the tier can never sit on a boundary and oscillate —
// which would be worse than either tier, since the change is the only part of
// this the walker can see.
const WINDOW = 90;
const DROP_AFTER = 45;      // consecutive frames over the ceiling
const RAISE_AFTER = 300;    // consecutive frames under the floor
const CEILING_MS = 18;
const FLOOR_MS = 12;
const HOLD_MS = 20000;

// A change of buffer is an allocation and a change of resolution is several, so
// both wait for a frame in which the eye is not moving. Not forever, though: a
// walker who never stands still would otherwise never get the tier they need.
const STILL_LOOK = 8;       // degrees per second
const STILL_MOVE = 0.35;    // metres per second
const SNAP_PATIENCE_MS = 2500;

const STORAGE_KEY = 'farfield.quality';

// How far the frame may change size before what was measured about this machine
// stops being about this frame.
//
// The calibration answers a question about a number of pixels, not about a
// graphics card: the same machine that draws a windowed frame in nine
// milliseconds draws a full screen one in seventeen. A third more or a quarter
// fewer pixels is enough to move a tier, so past that the stored answer is
// treated as no answer and the three seconds are paid again — on the next
// visit, never in the middle of one, because taking the eye off a walker who is
// already walking is worse than any tier.
const PIXEL_TOLERANCE = 0.35;

function tierIndex(id) {
  const found = TIERS.findIndex((tier) => tier.id === id);
  return found === -1 ? TIERS.findIndex((t) => t.id === DEFAULT_TIER) : found;
}

/** What was decided about this machine last time, if anything was. */
export function readStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    return {
      tier: typeof stored.tier === 'string' ? stored.tier : null,
      choice: CHOICES.includes(stored.choice) ? stored.choice : 'auto',
      benchMs: typeof stored.benchMs === 'number' ? stored.benchMs : null,
      pixels: typeof stored.pixels === 'number' ? stored.pixels : null,
    };
  } catch {
    return null;
  }
}

function writeStored(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A machine that refuses to remember gets calibrated again next time,
    // which is three seconds and not a failure.
  }
}

/** Whether this machine still has to be asked, for a frame of this many pixels. */
export function needsBenchmark(pixels) {
  const stored = readStored();
  if (!stored?.tier) return true;
  if (!stored.pixels || !pixels) return false;
  const ratio = pixels / stored.pixels;
  return ratio > 1 + PIXEL_TOLERANCE || ratio < 1 - PIXEL_TOLERANCE;
}

export function forgetStored() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* see above */ }
}

/**
 * Holds the frame to a tier, and moves it when the machine says so.
 *
 * @param {object} parts  the renderer facade and the hub, which between them
 *                        own every lever there is
 */
export function createQuality({ renderer, hub }) {
  const stored = readStored();
  let choice = stored?.choice ?? 'auto';
  let benched = stored?.tier ?? null;
  // What the calibration found, and how big the frame was when it found it.
  // Both survive a change of mind about the tier: a walker who picks a tier by
  // hand and later goes back to Auto gets the machine's own answer back, not a
  // second calibration.
  let benchMs = stored?.benchMs ?? null;
  let benchPixels = stored?.pixels ?? null;
  let index = tierIndex(choice === 'auto' ? (benched ?? DEFAULT_TIER) : CHOICE_TIER[choice]);
  let applied = null;

  // What is waiting for a still frame, and since when.
  let pending = null;
  let pendingSince = 0;

  const samples = new Float32Array(WINDOW);
  let count = 0;
  let cursor = 0;
  let hot = 0;
  let cold = 0;
  let changedAt = -HOLD_MS;
  const listeners = [];

  function announce() {
    for (const listener of listeners) listener(TIERS[index], choice);
  }

  /** Everything that can be moved without allocating anything. */
  function applySoft(tier) {
    hub.setGrassQuality(tier.grass);
    // The first of the levers declared above to gain a reader. It is soft in
    // the sense that matters here -- it allocates nothing and blocks nothing --
    // but the ground reads it once, when it is built: see hub.setVoxelDiscRadius.
    hub.setVoxelDiscRadius(tier.voxelDiscRadius);
    // And how finely the ground is resolved, which unlike the radius above is
    // one uniform and therefore reaches the frame that is drawn next.
    hub.setGroundDetail(tier.groundDetail);
    renderer.setBloomTier(tier.bloom);
  }

  /** And the four that reallocate the buffers the frame is drawn into. */
  function applyHard(tier) {
    // THE GROUND'S OWN PIXEL, AND THE WORLD ANSWERS FIRST. The lever has two
    // halves that have to agree on one number -- which of the field's two
    // meshes draws, and whether the frame gives the marcher a buffer of its own
    // -- and a handle in the address may overrule the tier on the world's half.
    // So the world is asked, and what it SETTLED ON is what the renderer is
    // told, rather than what this tier wanted. Told in that order, too: the
    // buffer must exist before the quad that reads it is made visible, and the
    // quad must be hidden before the buffer goes away.
    renderer.setCampoScale(hub.setCampoScale(tier.campoScale ?? 1));
    // Through the same seam the development panel grades through: the pixel of
    // the scene buffer is a property of the picture, like the bloom's shape,
    // and not one of the levers every caller of the renderer needs to know
    // about.
    renderer.post.setSceneFormat(tier.sceneFormat);
    renderer.setSamples(tier.samples);
    renderer.setRenderScale(tier.scale);
  }

  function apply(tier, { immediate = false } = {}) {
    applySoft(tier);
    const needsHard = !applied || applied.scale !== tier.scale || applied.samples !== tier.samples
      || applied.sceneFormat !== tier.sceneFormat || applied.campoScale !== tier.campoScale;
    if (!needsHard) {
      applied = tier;
      return;
    }
    if (immediate) {
      applyHard(tier);
      applied = tier;
      pending = null;
      return;
    }
    pending = tier;
    pendingSince = performance.now();
  }

  function settle(tier, { immediate = false } = {}) {
    index = tierIndex(tier);
    changedAt = performance.now();
    hot = 0;
    cold = 0;
    count = 0;
    cursor = 0;
    apply(TIERS[index], { immediate });
    announce();
  }

  function store() {
    writeStored({
      tier: benched, choice, benchMs, pixels: benchPixels,
    });
  }

  function median() {
    if (count < WINDOW) return null;
    const sorted = Float32Array.from(samples).sort();
    return sorted[WINDOW >> 1];
  }

  function percentile(fraction) {
    if (count === 0) return null;
    const sorted = Float32Array.from(samples.subarray(0, count)).sort();
    return sorted[Math.min(count - 1, Math.floor(count * fraction))];
  }

  const api = {
    get tier() { return TIERS[index]; },
    get choice() { return choice; },
    get automatic() { return choice === 'auto'; },
    get medianMs() { return median(); },
    get p95Ms() { return percentile(0.95); },
    get pending() { return pending; },

    onChange(listener) { listeners.push(listener); return api; },

    /** Puts the current tier on the frame at once, buffers and all. */
    start() {
      apply(TIERS[index], { immediate: true });
      announce();
    },

    /** What the benchmark decided, which is only ever a starting point. */
    setBenchmark(tierId, medianMs) {
      const buffer = renderer.drawingBuffer();
      benched = tierId;
      benchMs = medianMs;
      benchPixels = buffer.width * buffer.height;
      store();
      if (choice !== 'auto') return;
      settle(tierId, { immediate: true });
    },

    /** What the walker asked for, which outranks it. */
    setChoice(next) {
      if (!CHOICES.includes(next) || next === choice) return;
      choice = next;
      store();
      settle(choice === 'auto' ? (benched ?? DEFAULT_TIER) : CHOICE_TIER[choice]);
    },

    /**
     * One frame of evidence.
     *
     * @param {number} gpuMs   what the frame cost, by the driver's clock or the
     *                         wall clock filtered
     * @param {object} motion  how fast the eye is turning and the body moving
     */
    sample(gpuMs, motion) {
      const now = performance.now();

      // The deferred half of a tier change, taken the moment the eye is still —
      // or taken anyway, once waiting for that has become the worse of the two.
      if (pending) {
        const still = motion.lookRate < STILL_LOOK && motion.speed < STILL_MOVE;
        if (still || now - pendingSince > SNAP_PATIENCE_MS) {
          applyHard(pending);
          applied = pending;
          pending = null;
        }
      }

      if (!Number.isFinite(gpuMs) || gpuMs <= 0) return;
      samples[cursor] = gpuMs;
      cursor = (cursor + 1) % WINDOW;
      if (count < WINDOW) count++;

      hot = gpuMs > CEILING_MS ? hot + 1 : 0;
      cold = gpuMs < FLOOR_MS ? cold + 1 : 0;

      if (choice !== 'auto' || now - changedAt < HOLD_MS) return;

      if (hot >= DROP_AFTER && index < TIERS.length - 1) {
        settle(TIERS[index + 1].id);
        return;
      }
      // Never above what the machine was measured at: the benchmark saw the
      // whole framing at once and a quiet stretch of walking has not.
      const ceiling = tierIndex(benched ?? DEFAULT_TIER);
      if (cold >= RAISE_AFTER && index > ceiling) settle(TIERS[index - 1].id);
    },
  };

  return api;
}
