// A piano that plays in this world, and never plays the same thing twice.
//
// WHY THERE IS NO PIECE OF MUSIC HERE ANY MORE. A recording is a length of time
// with a beginning and an end, and a walker who stays is a walker who hears it
// come round. Every trick for hiding that — a long silence between occurrences,
// a level that drifts a decibel each time — hides the seam without removing it.
// What this world wants is the opposite of a piece: something that has been
// going on before you arrived and will not resolve while you are here, the way a
// memory of a distant place does not resolve.
//
// So the notes are real and the music is not. The timbre is a grand piano
// sampled note by note; everything else — which note, how hard, how long after
// the last one, and the room it all falls into — is decided as it happens. There
// is no arrangement to loop, so there is no loop to hide.
//
// AND YET THERE IS A THEME, which is the thing that arrived after all of the
// above was true and did not contradict any of it. A theme is not a piece: it is
// a shape — five notes and a proportion — that the world states, takes apart,
// carries somewhere else, turns over, and comes back to, and none of those
// things is a recording and none of them repeats. The shape lives in
// `theme.js`, in scale degrees, which is why the same theme can be spoken in
// both characters and come out as two different sets of intervals. What it buys
// is the one thing a generator cannot buy any other way: a listener who has been
// here five minutes RECOGNISES something.
//
// AND IT NEVER ENDS. There is no state in this file that means "the piece is
// over": `pump` schedules the next phrase before the last one has finished, and
// it will do that for as long as the world is open. What a listener gets is
// breathing — a phrase, then eight to eighteen seconds of room and air, then
// another phrase — and never the thing a recording does, which is to finish and
// leave nothing behind it. The silences are part of the music; the END of the
// music does not exist.
//
// THE PROPERTY THIS FILE GUARANTEES BY CONSTRUCTION, restated now that there is
// a theme. No two FREE phrases in a visit have the same sequence of intervals —
// that is a rejection filter with a memory, and when rejection would starve the
// phrase is lengthened rather than repeated. A THEMATIC phrase is the opposite
// case on purpose: a theme that returns must repeat its intervals, or it is not
// a theme. So what may not repeat there is the REALISATION — which form, spoken
// from where, in which octave, at which breadth — and that has a memory of its
// own. See `drawPhrase` and `theme.js`.
//
// AND THE ROOM IS SYNTHESISED. The long tail everything falls into is a network
// of delays, not a recorded impulse: four allpasses of diffusion, then eight
// damped comb filters and two more allpasses PER CHANNEL, whose decay time and
// darkness are live parameters. That matters twice — nothing of anybody else's
// room is shipped, and the character and the weather can move the room while it
// is sounding.

import { createDiscourse } from './theme.js';
import { createStrings } from './strings.js';

/**
 * WHAT WAS SAMPLED, AND HOW IT IS LAID OUT.
 *
 * Thirteen keys four semitones apart across four octaves, in two velocity
 * layers: the runtime therefore never stretches a sample by more than two
 * semitones, which is inside the range where a piano still sounds like the same
 * instrument rather than like a tape.
 *
 * The pitches here are the pitches that were MEASURED from the recordings —
 * fundamental by autocorrelation, every one of the twenty-six within seventeen
 * cents of the note it claims to be — and not the pitches its file name claimed.
 * The deviation is not corrected: it is smaller than the stretch tuning of any
 * real piano, and it is not consistent between the two layers of the same key,
 * which is the tell that most of it is the measurement rather than the tuning.
 *
 * THE DELIVERY IS TWO FILES AND THAT IS A LOADING DECISION, not a musical one.
 * Decoding compressed audio costs tens of milliseconds of MAIN THREAD per second
 * of sound — twenty-three of them per second on the slowest machine this campaign
 * is measured on — and every one of them is paid before the first note can
 * sound. So the keys the opening phrases live in are their own small file, and
 * everything else follows behind it.
 *
 * AND THE CORE IS FOUR KEYS RATHER THAN SEVEN, which is worth about a second and
 * a half on a loaded machine and costs nothing audible. Four adjacent keys are
 * sixteen semitones of playable range once the two semitones of stretch either
 * side are counted, and both characters' opening statement of the theme spans
 * fewer than fifteen — so the shape that a visitor hears first is the shape, at
 * whatever octave fits, rather than a folded approximation of it. The engine
 * plays with whatever has arrived: one file is already an instrument, and where
 * a phrase sits is chosen against what has arrived rather than against what
 * eventually will.
 */
export const PIANO = {
  // Middle C is 60. Four semitones apart, C2 to C6.
  midi: [36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84],
  // How long each key's slot is in the sprite, in seconds. Low strings ring far
  // longer than high ones, so a uniform slot would either cut the bottom of the
  // instrument off or spend half the package on silence at the top.
  slot: [6.0, 5.7, 5.4, 5.1, 4.8, 4.5, 4.2, 3.9, 3.6, 3.3, 3.0, 2.7, 2.4],
  // Two velocity layers: 0 is the soft one, 1 the middle one. They are not two
  // levels of the same sound — a piano struck softly is a DIFFERENT timbre, far
  // less bright, and that is the whole reason to carry two of them. Level is
  // then set continuously in the runtime, on top of the choice of layer.
  layers: 2,
  // Every slot ends with a damper: the note rings naturally and is then closed
  // over the last two seconds of its slot. That is what a piano does when the
  // pedal comes up, it is why the slots can be short enough to ship, and the
  // ring that a listener actually hears afterwards is the room, below.
  release: 2.0,
  files: [
    // [key, layer] pairs, in the order they sit in the sprite.
    { name: 'piano-1.m4a', slots: [[3, 1], [4, 1], [5, 1], [6, 1]] },
    {
      name: 'piano-2.m4a',
      slots: [
        [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0],
        [7, 0], [8, 0], [9, 0], [10, 0], [11, 0], [12, 0],
        [0, 1], [1, 1], [2, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [12, 1],
      ],
    },
  ],
};

const SCALES = {
  // Semitones from the root. Two are in use and the other two are the ones the
  // rejected characters were built on: they are kept because a mode is four
  // numbers and because they cost nothing to keep.
  //
  // THE THEME DEPENDS ON A PROPERTY BOTH OF THE TWO IN USE HAVE: the last degree
  // before the octave is ten semitones. That is what makes the motif end a whole
  // tone below its own first note in EITHER character, which is the one interval
  // of it that survives being spoken in a different mode. A third mode put into
  // service here wants checking against that before it is believed.
  dorico: [0, 2, 3, 5, 7, 9, 10],
  pentatonica: [0, 3, 5, 7, 10],
  eolio: [0, 2, 3, 5, 7, 8, 10],
  armonica: [0, 2, 3, 5, 7, 8, 11],
};

/**
 * THE TWO CHARACTERS.
 *
 * Every number below is taste, and taste is the one thing this file cannot
 * settle on its own — so four were built, rendered by this engine and put in
 * front of the committente, and these two are the ones that came back. They are
 * not two presets of one sound: the mode, the register, the width of the
 * intervals, the length of the silences and the room are all different.
 *
 *   B «Ricordo»  dorian, middle register, phrases that fall — the one that is
 *                nearly a melody, and the default.
 *   C «Infinito» minor pentatonic across four octaves, with single notes left
 *                high and alone — the one that is a place rather than a tune.
 *
 * TWO WERE CUT. A held-back harmonic minor was taken out before the panel: in a
 * sparse texture it puts a leading note over a long silence, and a leading note
 * is a Romantic gesture — classical sadness, which is a different feeling from
 * a place remembered from far away. A very low, very rare aeolian went to the
 * panel and was rejected there.
 *
 *   root      where the mode is centred, as a MIDI note
 *   register  the lowest and highest note the walk is allowed to reach
 *   steps     how far a FREE phrase moves between notes, in SCALE DEGREES — the
 *             theme does not draw from this, it has its own shape
 *   length    how many notes a free phrase has, before dyads
 *   descend   how often the next note is lower than the last
 *   spacing   seconds between one note and the next, inside a phrase. Its MEAN
 *             is also the unit the theme's proportions are multiplied by, which
 *             is what makes the theme slower in the wider character without a
 *             number anywhere saying so
 *   gap       seconds of breath between the end of a phrase and the next one
 *   dyad      how often a note is doubled, and by what
 *   velocity  how hard, from nothing to everything
 *   tone      the top the piano is heard through — distance takes the treble
 *   rt60      how long the room takes to fall sixty decibels
 *   damp      how dark the room's own tail is
 *   star      how often a phrase throws one note up out of its register, and
 *             where. B has a range and no probability: it never does this by
 *             daylight, and under a sky full of moving stars it does
 *   level     what the whole of it is worth, and why it is not the same number
 *             twice: a wide character with high notes in a long room measures
 *             far louder than a middle one in a shorter room, and left alone the
 *             two differed by seventeen decibels through an A-weighting. These
 *             trims were MEASURED, so that the two can be judged on what they
 *             are rather than on which one happens to be louder.
 */
export const CHARACTERS = {
  B: {
    label: 'Ricordo',
    scale: 'dorico',
    root: 50,
    register: [38, 72],
    centre: 55,
    length: [3, 5],
    steps: [-5, -4, -3, -2, -2, 2, 3, 4],
    // The one that is nearly a melody: phrases that fall, in the mode whose
    // minor third and major sixth together are the sound of remembering
    // something fondly. It is the closest to music, and therefore the one held
    // furthest back in the room — a memory of a piano rather than a piano.
    descend: 0.70,
    spacing: [1.05, 2.2],
    gap: [8, 17],
    dyad: 0.16,
    dyadOf: [7, 12],
    velocity: [0.26, 0.44],
    tone: 2900,
    rt60: 6.5,
    damp: 2000,
    wet: 0.90,
    dry: 0.44,
    predelay: 0.042,
    level: 1.09,
    starRange: [69, 81],
  },
  C: {
    label: 'Infinito',
    scale: 'pentatonica',
    root: 40,
    register: [36, 84],
    centre: 52,
    length: [2, 4],
    // Four octaves wide, in the one scale with no semitone in it: nothing ever
    // resolves, because there is nothing in a minor pentatonic that wants to.
    steps: [-6, -5, -4, -3, 3, 4, 5, 6],
    descend: 0.46,
    spacing: [1.5, 3.2],
    gap: [9, 18],
    dyad: 0.12,
    dyadOf: [12, -12, 7],
    velocity: [0.24, 0.42],
    tone: 3000,
    rt60: 8.5,
    damp: 1900,
    wet: 1.00,
    dry: 0.38,
    predelay: 0.075,
    level: 1.04,
    // The stars. Now and then a phrase leaves the register it has been walking
    // in and puts one note two octaves above it, alone, and comes back down. It
    // is the one gesture in either character that is a picture rather than a
    // mood, and it is what the committente heard when they picked this one.
    star: 0.28,
    starRange: [74, 84],
  },
};

export const DEFAULT_CHARACTER = 'B';

/**
 * WHAT THE WORLD DOES TO THE MUSIC.
 *
 * The brief is one theme and never a second one: when the world changes, the
 * SAME motif is re-dressed rather than replaced. So nothing below chooses notes.
 * Every field is a multiplier or a bias on something the character already
 * declared — how fast, how wide, how dark, how far, how often there is a bow
 * under it — and the shape that comes out the other side is the shape that went
 * in.
 *
 * AND THEY COMPOSE, on two axes. Light is continuous, because the world's day
 * and night is one number that moves; weather is a state, because rain is not
 * halfway to a starfield. An effective profile is the light blended between its
 * ends and then multiplied by the weather, so "raining at night" is a thing that
 * can exist without a fifth entry being written for it.
 *
 * TRANSITIONS HAPPEN ON PHRASE BOUNDARIES, and that falls out of the design
 * rather than being enforced: everything discrete here is read once, at the
 * moment a phrase is drawn, and everything continuous is ramped into over a
 * quarter of a second. Nothing already scheduled is ever touched.
 */
const LIGHT = {
  giorno: {
    pace: 1, gap: 1, tone: 1, rt60: 1, damp: 1, dry: 1, wet: 1, level: 1,
    velocity: 1, theme: 1, dyad: 1, width: 1, shift: 0, starMul: 1, starAdd: 0,
    bow: 0.42, bowTone: 1, bowLevel: 1, bowWet: 1,
  },
  notte: {
    // Slower, lower, and with the light taken off the top of the instrument.
    // More thematic rather than less: what a mind does at night is return to one
    // thing, and the free invention is what thins out first.
    pace: 1.42, gap: 1.28, tone: 0.58, rt60: 1.18, damp: 0.65, dry: 1.0,
    // MEASURED DOWN, and against the instinct that said it would need lifting.
    // Taking the treble off costs A-weighted loudness, so night looked like it
    // would come out quiet; it came out three decibels LOUD, because dropping
    // the register five semitones runs into the register tilt that makes the
    // bottom of this instrument weightier, and because night is more thematic
    // and a statement of the theme is five notes with a leaned-on apex.
    wet: 1.06, level: 0.70, velocity: 0.90, theme: 1.16, dyad: 1.10, width: 1,
    shift: -5, starMul: 0.7, starAdd: 0,
    bow: 0.54, bowTone: 0.80, bowLevel: 1.08, bowWet: 1.05,
  },
};

const WEATHER = {
  sereno: {
    pace: 1, gap: 1, tone: 1, rt60: 1, damp: 1, dry: 1, wet: 1, level: 1,
    velocity: 1, theme: 1, dyad: 1, width: 1, shift: 0, starMul: 1, starAdd: 0,
    bowMul: 1, bowTone: 1, bowLevel: 1, bowWet: 1, violino: 0, forms: [],
  },
  pioggia: {
    // Intimate, and intimacy is a SHORT ROOM. Rain deadens a place — it is the
    // one weather that measurably takes reverberation away — so the tail comes
    // down by a third and the dry part comes up, which together move the piano
    // from the far end of somewhere to the near end of it. The treble is only
    // slightly darker, because a piano heard close through rain is not a piano
    // heard far away.
    //
    // Sparser, and with far more bow under it. Both are the same instruction:
    // fewer events, each of them held longer.
    pace: 1.06, gap: 1.26, tone: 0.90, rt60: 0.70, damp: 0.85, dry: 1.22,
    // A short room is a quiet room: cutting the tail by a third took more level
    // with it than the closer dry signal put back, so this hands a decibel back.
    wet: 0.72, level: 1.12, velocity: 0.88, theme: 1.05, dyad: 1.35,
    width: 0.7, shift: -2, starMul: 0.25, starAdd: 0,
    bowMul: 1.95, bowTone: 0.95, bowLevel: 1.35, bowWet: 0.75, violino: 0,
    // The fragments, because rain is not the weather for a whole sentence.
    forms: ['sospiro', 'coda'],
  },
  startrail: {
    // A different rhythm and more motion, which is diminution and nothing else:
    // the same proportions, taken faster, with less silence between them. Wider
    // in register by nearly double, so the arc's own octaves reach twice as far
    // and the theme can break across two of them. Brighter and much longer in
    // the room, which is the only pair of numbers in this file that means
    // "enormous".
    //
    // And the stars, in BOTH characters: the one gesture that is a picture
    // rather than a mood is exactly the gesture a sky of moving light wants, so
    // the character that never does it by day does it here.
    pace: 0.70, gap: 0.80, tone: 1.24, rt60: 1.50, damp: 1.20, dry: 0.86,
    // TRIMMED TWICE, IN OPPOSITE DIRECTIONS, and the second time was the
    // interesting one. It first measured ABOVE the walker's own feet — the one
    // thing the mix of this world does not allow — because the violin was
    // getting in on its own probability rather than on its share of the bowed
    // phrases, so nearly half of every phrase here had a note at the top of the
    // range where an ear is most sensitive. Fixing that took most of the state's
    // loudness with it and left it six decibels UNDER the state the world opens
    // in, which is the wrong answer for the one state that is supposed to feel
    // like more. This is the trim for the fixed version.
    wet: 1.18, level: 1.07, velocity: 1.06, theme: 1.10, dyad: 0.80,
    width: 1.9, shift: 2, starMul: 1, starAdd: 0.30,
    bowMul: 0.80, bowTone: 1.30, bowLevel: 0.90, bowWet: 1.20, violino: 0.50,
    forms: ['lontana', 'inversa', 'testa'],
  },
};

/**
 * The four states the world can ask for by name, as a light and a weather.
 *
 * `startrail` sets the light to night as well, and that is not a shortcut: a
 * star trail is a photograph of several hours after dark, and a bright version
 * of it would be a picture of nothing.
 */
export const MOODS = {
  giorno: { label: 'Giorno', night: 0, weather: 'sereno' },
  notte: { label: 'Notte', night: 1, weather: 'sereno' },
  pioggia: { label: 'Pioggia', night: null, weather: 'pioggia' },
  startrail: { label: 'Star trail', night: 1, weather: 'startrail' },
};

export const DEFAULT_MOOD = 'giorno';

export const MIX = {
  // What the whole engine is worth at its output, before the music bus. Set so
  // that the loudest second of the piano sits where the walk asked the melody to
  // sit: clearly audible, and under the feet.
  gain: 1.41,
  // How the level of a note follows how hard it was struck. Above one, which is
  // what makes a soft note soft rather than merely quieter.
  velocityCurve: 1.45,
  // Which layer a velocity reaches for. Below this the soft, darker recording;
  // above it the middle one.
  velocitySplit: 0.34,
  // The top of the instrument is quieter than the bottom, because a sample set
  // normalised key by key is not how a piano balances and because an ear at this
  // level is far more sensitive up there. Decibels per octave above C3.
  registerTiltDbPerOctave: -4.0,
  // How far apart the keyboard is spread across the stereo picture. A piano is
  // one object in a room, not an orchestra: this is a suggestion.
  spread: 0.26,
  // Humanisation. A phrase whose notes land on exact seconds is a sequencer.
  timingMs: 34,
  velocityJitter: 0.16,
  // How long the two notes of a dyad are apart. A hand is not a chord machine.
  rollMs: [12, 48],
  // HOW MUCH LOUDER ONE VISIT IS THAN ANOTHER, and it is a knob rather than a
  // fact because it was measured and found to be twenty decibels between the
  // loudest and the quietest of sixteen. That spread is not a defect — it is a
  // player with real dynamics, and a generator whose every phrase is the same
  // weight is a music box.
  //
  // This scales ONLY the draw that sets a whole phrase's weight, around its own
  // mean. At one it is the player as measured; at nought every phrase opens at
  // the average and the piano is still fully alive inside itself, because the
  // lean of a phrase, the jitter on each note, the softer star and the lighter
  // long phrase are all untouched. It flattens the DIFFERENCE BETWEEN VISITS
  // without flattening the piano, which is the only reason it exists.
  dynamicSpread: 1.0,
};

// The room: four diffusing allpasses before the split, then eight comb delays
// and two more allpasses on each side. All mutually incommensurate, and none of
// them a whole multiple of another: what an ear must not
// be able to find in here is a repeat, and a delay network's repeats are its
// delay times. The right channel's combs are the left's plus a constant, which
// is what puts the two tails in different places without making them a different
// room.
const COMBS = [0.0553, 0.0611, 0.0662, 0.0717, 0.0753, 0.0799, 0.0841, 0.0893];
const COMB_SPREAD = 0.00131;
const DIFFUSERS = [0.00711, 0.00953, 0.01277, 0.01699];
const TAIL_ALLPASS = [0.00521, 0.00887];

// For lowpass and highpass — and only for those two — Web Audio reads the Q
// field as DECIBELS, so the number that means "no resonance at all" is not 0.707
// but twenty times its logarithm. Written down because it is the kind of thing
// that turns a filter into a ringing one without anything looking wrong.
const FLAT_Q_DB = -3.01;

// The longest silence this world will ever put between two phrases. See `pump`.
const MAX_BREATH = 24;

// How long after the piano has finished decoding the bowed voice is asked for.
// See `load`. Wall clock and not the audio clock on purpose: what this is
// getting out of the way of is the main thread, and the main thread does not
// keep audio time.
const STRINGS_DELAY_MS = 6000;

function clamp(v, low, high) { return v < low ? low : (v > high ? high : v); }
function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * Where the encoder put the sprite.
 *
 * Every key was cut so its attack sits exactly on its slot boundary, and the
 * encoder then moved the whole file by a constant it is not obliged to declare.
 * So it is measured: the first sample over a fraction of the slot's own peak,
 * looked for in a short window after each nominal boundary, and the MEDIAN of
 * the answers — a median survives the one slot whose opening is soft enough to
 * fool a threshold, and a mean does not.
 */
function spriteDelay(buffer, offsets, slots) {
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  const window = Math.round(rate * 0.050);
  const found = [];
  for (let k = 0; k < offsets.length; k++) {
    const at = Math.round(offsets[k] * rate);
    const end = Math.min(data.length, at + Math.round(slots[k] * rate));
    let top = 0;
    for (let i = at; i < end; i++) { const v = Math.abs(data[i]); if (v > top) top = v; }
    if (top <= 0) continue;
    const threshold = top * 0.05;
    for (let i = at; i < Math.min(data.length, at + window); i++) {
      if (Math.abs(data[i]) > threshold) { found.push(i - at); break; }
    }
  }
  if (!found.length) return 0;
  found.sort((a, b) => a - b);
  return found[found.length >> 1] / rate;
}

/**
 * One Schroeder allpass: flat in magnitude, and a mess in phase, which is
 * exactly what diffusion is. Returns the node the next stage reads from.
 *
 * v[n] = x[n] + g·v[n−M],  y[n] = −g·v[n] + v[n−M]
 *
 * The delay is the only thing in the feedback cycle, which is what Web Audio
 * requires of a cycle, and every M here is well over the one render quantum the
 * engine will silently round up to.
 */
function allpass(context, source, seconds, g) {
  const v = context.createGain();
  const delay = context.createDelay(1);
  delay.delayTime.value = seconds;
  const back = context.createGain();
  back.gain.value = g;
  const forward = context.createGain();
  forward.gain.value = -g;
  const out = context.createGain();
  source.connect(v);
  v.connect(delay);
  delay.connect(back).connect(v);
  v.connect(forward).connect(out);
  delay.connect(out);
  return out;
}

/**
 * The long room, synthesised.
 *
 * A comb bank makes the tail and a pair of allpasses smear what comes out of it.
 * The damping filter sits INSIDE each comb's feedback, so every trip round the
 * loop takes a little more treble off — which is the difference between a tail
 * that decays and a tail that recedes. A far away room is a dark room.
 *
 * Its two controls are RAMPED and not set, because the world can now change the
 * weather while the room is ringing: stepping a comb's feedback in the middle of
 * a tail steps the tail, and a tail that jumps is the one thing in a reverberator
 * an ear finds instantly.
 */
function buildRoom(context, character) {
  const input = context.createGain();
  // NOTHING BELOW THE INSTRUMENT GETS INTO THE LOOP, and this is not a nicety.
  // A comb at the feedback these run at has a gain of about twenty-two at nought
  // hertz, and a decoder leaves a little sub-audio wander in everything it
  // hands back: fed straight in, that wander piles up for as long as the world
  // is open. It was measured before it was fixed — six percent of the energy of
  // a ten minute render was under fifty hertz, the largest sample in the whole
  // thing sat at three and a half minutes with no note near it, and the level of
  // the melody moved by ten decibels between two renders of identical settings.
  // Two poles at sixty hertz cost the lowest key about three decibels OF ITS
  // REVERB, which is a thing tall rooms do anyway, and take twenty hertz down by
  // sixty.
  const cutA = context.createBiquadFilter();
  cutA.type = 'highpass';
  cutA.frequency.value = 60;
  cutA.Q.value = FLAT_Q_DB;
  const cutB = context.createBiquadFilter();
  cutB.type = 'highpass';
  cutB.frequency.value = 60;
  cutB.Q.value = FLAT_Q_DB;
  const predelay = context.createDelay(0.5);
  predelay.delayTime.value = character.predelay;
  input.connect(cutA).connect(cutB).connect(predelay);

  let front = predelay;
  for (let i = 0; i < DIFFUSERS.length; i++) front = allpass(context, front, DIFFUSERS[i], 0.63);

  const merger = context.createChannelMerger(2);
  const feedbacks = [];
  const dampers = [];
  for (let ch = 0; ch < 2; ch++) {
    const bank = context.createGain();
    bank.gain.value = 1 / COMBS.length;
    for (let i = 0; i < COMBS.length; i++) {
      const seconds = COMBS[i] + ch * COMB_SPREAD;
      const node = context.createGain();
      const delay = context.createDelay(1);
      delay.delayTime.value = seconds;
      const damp = context.createBiquadFilter();
      damp.type = 'lowpass';
      damp.Q.value = FLAT_Q_DB;
      const back = context.createGain();
      front.connect(node);
      node.connect(delay);
      delay.connect(damp).connect(back).connect(node);
      delay.connect(bank);
      feedbacks.push({ gain: back.gain, seconds });
      dampers.push(damp.frequency);
    }
    let tail = bank;
    for (let i = 0; i < TAIL_ALLPASS.length; i++) {
      tail = allpass(context, tail, TAIL_ALLPASS[i] + ch * 0.00037, 0.52);
    }
    tail.connect(merger, 0, ch);
  }

  const output = context.createGain();
  merger.connect(output);

  function setDecay(rt60, ramp = 0, when = 0) {
    // A comb of length L that loses this much each trip falls sixty decibels in
    // rt60 seconds. Capped short of one, because a comb at one is not a room.
    for (const fb of feedbacks) {
      const value = clamp(10 ** (-3 * fb.seconds / rt60), 0, 0.972);
      if (ramp > 0) fb.gain.setTargetAtTime(value, when, ramp);
      else fb.gain.value = value;
    }
  }
  function setDamp(hz, ramp = 0, when = 0) {
    const value = clamp(hz, 200, 18000);
    for (const d of dampers) {
      if (ramp > 0) d.setTargetAtTime(value, when, ramp);
      else d.value = value;
    }
  }
  setDecay(character.rt60);
  setDamp(character.damp);
  return {
    input, output, setDecay, setDamp,
  };
}

/**
 * The piano, the bowed voice under it, and the thing that decides what they play.
 *
 * @param {object} options
 * @param {BaseAudioContext} options.context  the live context, or an offline one
 * @param {AudioNode} options.destination     the music bus this feeds
 * @param {string} options.base               where the package is served from
 * @param {string} [options.character]        which of the two to open with
 * @param {string} [options.mood]             which state of the world to open in
 * @param {(note: object) => void} [options.onNote]  every scheduled note
 * @param {() => number} [options.random]  where the choices come from. The
 *   default is the one every visit gets; a harness that has to compare two
 *   renders hands in a seeded one instead, because two renders of a generator
 *   whose visits spread over sixteen decibels cannot be told apart by their
 *   medians — see `theme.js`, where the same argument is made at length.
 */
export function createMelody({
  context, destination, base = './', character = DEFAULT_CHARACTER,
  mood: moodName = DEFAULT_MOOD, onNote = null, random = Math.random,
}) {
  const between = (a, b) => a + random() * (b - a);
  const pick = (list) => list[Math.floor(random() * list.length)];
  let current = CHARACTERS[character] ? character : DEFAULT_CHARACTER;
  let mood = CHARACTERS[current];
  // Nought is the middle of a bright day and one is the middle of the night. It
  // is one number because the day and night this world will have is one number,
  // and it is separate from the weather because they are separate things.
  let night = 0;
  let weather = 'sereno';
  let profile = null;
  // What the world has asked for and has not been given yet. A change of state
  // is honoured at the next phrase boundary and never in the middle of one:
  // everything already sounding was scheduled under the old state and must be
  // allowed to finish being it.
  let pending = null;
  let active = true;

  const out = context.createGain();
  out.gain.value = MIX.gain;
  out.connect(destination);

  // A rumble filter over the whole instrument, dry and wet alike. The samples
  // were built with the room they were recorded in taken off the bottom, but a
  // decoder puts a little of its own back, and a piano has nothing to say below
  // thirty hertz that a listener will thank it for.
  const cut = context.createBiquadFilter();
  cut.type = 'highpass';
  cut.frequency.value = 32;
  cut.Q.value = FLAT_Q_DB;
  const tone = context.createBiquadFilter();
  tone.type = 'lowpass';
  tone.Q.value = FLAT_Q_DB;
  cut.connect(tone);
  const dry = context.createGain();
  const send = context.createGain();
  tone.connect(dry).connect(out);
  tone.connect(send);
  const room = buildRoom(context, mood);
  send.connect(room.input);
  room.output.connect(out);

  // The bowed voice goes into the SAME room and the same output. There is one
  // place in this world, and two instruments standing in it.
  const strings = createStrings({
    context, destination: out, room: room.input, base, random,
  });

  // What has arrived. Each entry is a playable slot: which key, which layer,
  // where it starts in its buffer and how long it is. `loaded` is the range of
  // keys currently playable, which is NOT the range that was sampled until the
  // second file lands — see playNote and placeShape.
  const slots = [];
  const loaded = { low: Infinity, high: -Infinity };
  const files = PIANO.files.map((f) => ({ ...f, buffer: null, delay: 0 }));
  let ready = false;
  let readyAt = 0;
  let openedAt = context.currentTime;

  // THE MEMORY THAT MAKES REPETITION IMPOSSIBLE, for the phrases that are free
  // invention. A phrase is refused if its sequence of intervals has been heard in
  // the last so many; refused often enough, it is lengthened instead, which moves
  // it into a space too big to have been exhausted. Ninety-six phrases is longer
  // than any visit, and it is bounded on purpose: an unbounded memory would
  // eventually have nothing left to allow.
  const MEMORY = 96;
  const recent = [];
  const log = [];
  let collisions = 0;
  let nextPhraseAt = 0;
  let firstNoteAt = null;
  let scheduled = 0;
  let costUs = 0;
  let peakUs = 0;

  const discourse = createDiscourse({ random });
  // Where the last phrase left off, so the next one can start near it rather
  // than always near the middle. A sequence of phrases that each begin in the
  // same place is a sequence of phrases that sound unrelated.
  let lastDegree = null;
  // The second voice's line, and the two things that keep it a line: where it
  // was, and what it did last time.
  let dyadVoice = null;
  let dyadInterval = null;
  let bowVoice = null;
  let bowRepeats = 0;
  let bowed = 0;
  let phraseId = 0;

  // ------------------------------------------------------------- the dressing

  /** Light blended between its two ends, then multiplied by the weather. */
  function computeProfile() {
    const a = LIGHT.giorno;
    const b = LIGHT.notte;
    const w = WEATHER[weather] || WEATHER.sereno;
    const mix = (key) => lerp(a[key], b[key], night);
    profile = {
      pace: mix('pace') * w.pace,
      gap: mix('gap') * w.gap,
      tone: mix('tone') * w.tone,
      rt60: mix('rt60') * w.rt60,
      damp: mix('damp') * w.damp,
      dry: mix('dry') * w.dry,
      wet: mix('wet') * w.wet,
      level: mix('level') * w.level,
      velocity: mix('velocity') * w.velocity,
      theme: mix('theme') * w.theme,
      dyad: mix('dyad') * w.dyad,
      width: mix('width') * w.width,
      shift: mix('shift') + w.shift,
      starMul: mix('starMul') * w.starMul,
      starAdd: mix('starAdd') + w.starAdd,
      bow: clamp(mix('bow') * w.bowMul, 0, 1),
      bowTone: mix('bowTone') * w.bowTone,
      bowLevel: mix('bowLevel') * w.bowLevel,
      bowWet: mix('bowWet') * w.bowWet,
      violino: w.violino,
      forms: w.forms,
    };
  }

  let placed = false;
  // How near the instrument is being heard right now, which the arc moves over
  // minutes. Held between phrases so what a listener gets is a slow breath
  // across the whole of an arc rather than a step at every boundary.
  let near = 1;

  // EVERY RAMP BELOW IS PLACED AT A TIME THAT IS HANDED IN, never at a time that
  // is read. It is the same decision `pump` is built on and for the same reason:
  // an offline context has no current time until it has already been rendered,
  // so a ramp that reads the clock puts every change of state in this world at
  // nought seconds — and the renders that everything here is judged on would
  // quietly stop being what the world plays.
  /** Just the distance, which is the only thing that moves between phrases. */
  function applyNear(when, ramp) {
    tone.frequency.setTargetAtTime(
      clamp(mood.tone * profile.tone * near, 250, 18000), when, ramp,
    );
  }

  /** Everything, which moves only when the character or the state does. */
  function applyColour(when = context.currentTime, ramp = 0.25) {
    const now = when;
    const level = MIX.gain * (mood.level ?? 1) * profile.level;
    // Set outright the first time and ramped afterwards: a state changed while a
    // room is still ringing must not step the tail it is ringing into.
    if (placed) {
      out.gain.setTargetAtTime(level, now, ramp);
      applyNear(now, ramp);
      dry.gain.setTargetAtTime(mood.dry * profile.dry, now, ramp);
      send.gain.setTargetAtTime(mood.wet * profile.wet, now, ramp);
    } else {
      out.gain.value = level;
      tone.frequency.value = clamp(mood.tone * profile.tone * near, 250, 18000);
      dry.gain.value = mood.dry * profile.dry;
      send.gain.value = mood.wet * profile.wet;
      placed = true;
    }
    room.setDecay(mood.rt60 * profile.rt60, placed ? ramp : 0, now);
    room.setDamp(mood.damp * profile.damp, placed ? ramp : 0, now);
    strings.setColour({
      tone: profile.bowTone, level: profile.bowLevel, wet: profile.bowWet,
    }, now);
  }

  // The state asked for at construction is the state it opens in, outright: a
  // world that fades into its own weather over the first phrase has a first
  // phrase that is not in any weather.
  {
    const asked = MOODS[moodName] || MOODS[DEFAULT_MOOD];
    if (asked.night !== null) night = asked.night;
    weather = asked.weather;
  }
  computeProfile();
  applyColour(0, 0);

  // ------------------------------------------------------------- the loading

  function addSlots(file) {
    let at = 0;
    const offsets = [];
    const lengths = [];
    for (const [key, layer] of file.slots) {
      offsets.push(at);
      lengths.push(PIANO.slot[key]);
      slots.push({
        key, layer, midi: PIANO.midi[key], file, offset: at, length: PIANO.slot[key],
      });
      loaded.low = Math.min(loaded.low, PIANO.midi[key]);
      loaded.high = Math.max(loaded.high, PIANO.midi[key]);
      at += PIANO.slot[key];
    }
    file.delay = spriteDelay(file.buffer, offsets, lengths);
  }

  async function load() {
    // Both asked for at once, and NOT at the same priority. The first file is
    // the one the promise about the first note is made of, so it goes into the
    // queue like anything else; the second is five times the size and nothing
    // waits on it, so it goes in as `low` and uses what the world leaves. The
    // hint is a hint and browsers that do not know the member ignore it, which
    // is the whole reason it is worth using: there is no fallback to write.
    const asked = files.map((f, i) => fetch(`${base}audio/piano/${f.name}`,
      i === 0 ? undefined : { priority: 'low' })
      .then((r) => {
        if (!r.ok) throw new Error(`${f.name} (${r.status})`);
        return r.arrayBuffer();
      }));
    // Decoded one after the other and not both at once, on purpose: decoding is
    // main thread work and the only thing that matters is when the FIRST file is
    // done. Two decodes started together finish together, and together is twice
    // as late as the one that mattered.
    for (let i = 0; i < files.length; i++) {
      try {
        const bytes = await asked[i];
        files[i].buffer = await context.decodeAudioData(bytes);
        addSlots(files[i]);
        if (!ready) { ready = true; readyAt = context.currentTime; }
      } catch (error) {
        console.warn(`piano non caricato: ${error.message}`);
      }
    }
    // AND THE BOW LAST OF ALL, AND NOT EVEN THEN.
    //
    // Decoding it costs seconds of MAIN THREAD — it is twenty-eight seconds of
    // audio, and this campaign has measured decoding at anywhere from twenty to
    // over two hundred milliseconds per second of sound depending on what else
    // the machine is doing. Asked for the moment the piano is done, all of that
    // lands inside the busiest window this world has: the one where the scene's
    // textures are still being transcoded and the walker has just been let in.
    //
    // So it waits. It is the least urgent thing here by a wide margin — a walker
    // who has not heard a bowed note in the first half minute has heard exactly
    // the world this was designed around, because the piano is the world and
    // this is the air around it — and the seconds it costs are worth far less
    // once nothing else wants them.
    //
    // AN OFFLINE CONTEXT SKIPS THE WAIT, because there is no world loading
    // around it to get out of the way of, and because every render this unit is
    // judged on would otherwise sit still for six seconds first. Nothing musical
    // depends on this branch: it changes WHEN bytes are asked for and nothing
    // whatever about what is played with them.
    if (typeof context.startRendering !== 'function') {
      await new Promise((done) => { setTimeout(done, STRINGS_DELAY_MS); });
    }
    await strings.load();
  }

  // --------------------------------------------------------------- the notes

  /** The nearest thing that was actually sampled to the note that was asked for. */
  function slotFor(midi, velocity) {
    const wanted = velocity < MIX.velocitySplit ? 0 : 1;
    let best = null;
    let bestCost = Infinity;
    for (const slot of slots) {
      // Distance in semitones, and a penalty for having to use the other layer:
      // two semitones of stretch is a smaller lie than the wrong timbre, but
      // only just.
      const cost = Math.abs(midi - slot.midi) + (slot.layer === wanted ? 0 : 1.6);
      if (cost < bestCost) { bestCost = cost; best = slot; }
    }
    return best;
  }

  /** Everything a note carries to whoever is listening to the note stream. */
  function emit(note) {
    // THE BOWED VOICE IS DRIVEN FROM HERE AND NOWHERE ELSE. It is subscribed to
    // the same stream of notes that any outside listener gets, and it reads one
    // field: a note that has been marked to be held is held, and every other
    // note goes past it. Which note that is was decided where the mode and the
    // register live, because a second voice that chose its own pitches would
    // need its own idea of the scale — and a second idea of the scale is a
    // second piece of music playing quietly over the first.
    if (note.sustain) {
      const done = strings.play({
        midi: note.sustain.midi,
        at: note.sustain.at,
        until: note.sustain.until,
        level: note.sustain.level,
        family: note.sustain.family,
      });
      if (done) bowed++;
    }
    if (onNote) onNote(note);
  }

  function playNote(wanted, at, velocity, extra = null) {
    // THE KEYBOARD ENDS WHERE THE SAMPLES END, and this is here because it was
    // once missing. A dyad an octave under the bottom of a character's register
    // asked for a note twelve semitones below anything recorded: the engine
    // obligingly played the lowest key at HALF SPEED — an octave down, and twice
    // as long as its slot was cut for — and then the register tilt, which makes
    // the bass weightier, multiplied it by two and a half. The result went into
    // an eight second room and put whole minutes of a render fifteen decibels
    // above the rest of it.
    //
    // AND IT FOLDS BY OCTAVES rather than clamping to the edge. For the few
    // seconds between the core arriving and the rest of the package arriving,
    // the playable range is four keys wide, and a phrase reaching past that
    // would otherwise be stretched by a whole octave — which is not a piano any
    // more. An octave is the one transposition that keeps the note the note.
    let midi = wanted;
    while (midi > loaded.high + 2) midi -= 12;
    while (midi < loaded.low - 2) midi += 12;
    const slot = slotFor(midi, velocity);
    if (!slot) return;
    const source = context.createBufferSource();
    source.buffer = slot.file.buffer;
    source.playbackRate.value = 2 ** ((midi - slot.midi) / 12);
    const gain = context.createGain();
    const tilt = 10 ** (MIX.registerTiltDbPerOctave * (midi - 48) / 12 / 20);
    gain.gain.value = velocity ** MIX.velocityCurve * tilt;
    const pan = context.createStereoPanner();
    // Where the key is under the hands, faintly. Centred on the middle of the
    // sampled range so the instrument does not sit off to one side.
    pan.pan.value = clamp((midi - 60) / 24, -1, 1) * MIX.spread;
    source.connect(gain).connect(pan).connect(cut);
    // The whole slot minus a hair, so a key can never sound the head of the one
    // stored after it. In buffer seconds, which is what start() reads.
    source.start(at, slot.offset + slot.file.delay, Math.max(0.05, slot.length - 0.02));
    source.onended = () => pan.disconnect();
    scheduled++;
    if (firstNoteAt === null) firstNoteAt = at;
    emit({
      midi, at, velocity, key: slot.key, layer: slot.layer, phrase: phraseId, ...extra,
    });
  }

  // -------------------------------------------------------------- the phrase

  function degreeToMidi(scale, root, degree) {
    const n = scale.length;
    const octave = Math.floor(degree / n);
    return root + octave * 12 + scale[((degree % n) + n) % n];
  }

  /** What is playable right now, which is not what was sampled until file two lands. */
  function playableRange() {
    const low = Number.isFinite(loaded.low) ? loaded.low - 2 : mood.register[0];
    const high = Number.isFinite(loaded.high) ? loaded.high + 2 : mood.register[1];
    return [Math.max(mood.register[0], low), Math.min(mood.register[1], high)];
  }

  /**
   * WHERE A SHAPE GOES, which is the whole of register planning.
   *
   * A free walk can be reflected off the edge of its register and be none the
   * worse: it is a walk, and a walk that turns round is still a walk. A THEME
   * cannot. Reflecting one note of it is not a transposition, it is a different
   * shape — and the shape is the only thing the theme has. So a statement is
   * PLACED: the octave is chosen so that the whole of it fits inside what is
   * both in the character's register and currently playable, and among the
   * octaves that fit, the one that lands nearest where the arc wants it.
   *
   * Returns null when nothing fits, and the caller then says less rather than
   * saying it wrongly.
   */
  function placeShape(midis, wantCentre) {
    const [low, high] = playableRange();
    let lo = Infinity;
    let hi = -Infinity;
    for (const m of midis) { if (m < lo) lo = m; if (m > hi) hi = m; }
    if (hi - lo > high - low) return null;
    const middle = (lo + hi) / 2;
    let best = null;
    for (let k = -48; k <= 48; k += 12) {
      if (lo + k < low || hi + k > high) continue;
      const distance = Math.abs(middle + k - wantCentre);
      if (!best || distance < best.distance) best = { k, distance };
    }
    return best ? best.k : null;
  }

  /**
   * One free phrase, guaranteed not to repeat one already heard.
   *
   * The walk itself is ordinary: a starting degree, then steps drawn from the
   * character's pool with a bias downwards, reflected when they would leave the
   * register. What is not ordinary is what happens next — the sequence of
   * intervals is compared against the last ninety-six, and a phrase that has been
   * heard before is drawn again. Twenty-four refusals in a row means the space of
   * phrases OF THAT LENGTH is nearly used up, so the phrase grows by a note, and
   * a space that was nearly exhausted is multiplied by the size of the step pool.
   *
   * WHERE IT STARTS is the one thing that changed when the theme arrived. It used
   * to open near the character's centre every time, which is correct in isolation
   * and wrong in succession: a phrase that begins a long way from where the last
   * one ended sounds like a different piece of music starting. It now begins
   * between the centre and the last note heard, which costs nothing and is the
   * difference between a sequence of phrases and a piece with phrases in it.
   */
  function drawPhrase(centreDegree) {
    const scale = SCALES[mood.scale];
    const span = mood.length[1] - mood.length[0] + 1;
    let length = mood.length[0] + Math.floor(random() * span);
    let notes = null;
    let starAt = -1;
    let signature = '';
    const star = clamp((mood.star ?? 0) * profile.starMul + profile.starAdd, 0, 1);
    let endDegree = centreDegree;
    for (let attempt = 0; attempt < 24 * 4; attempt++) {
      if (attempt > 0 && attempt % 24 === 0 && length < 6) length++;
      let degree = centreDegree + Math.round(between(-2.5, 2.5));
      // THE FIRST NOTE IS CHECKED LIKE EVERY OTHER ONE, and it did not used to
      // be. Every step after it is tested against the register and reflected if
      // it would leave; the opening note was simply taken, which was harmless
      // for as long as a phrase always began near the character's centre. It
      // does not any more — an arc moves where a phrase starts by as much as two
      // octaves — and an unchecked opening note put whole phrases a fifth below
      // the bottom of the character, where the only thing that saved them was
      // the sampler folding them back by octaves into something that was no
      // longer the register anybody had planned.
      while (degreeToMidi(scale, mood.root, degree) < mood.register[0]) degree++;
      while (degreeToMidi(scale, mood.root, degree) > mood.register[1]) degree--;
      starAt = -1;
      const walk = [degreeToMidi(scale, mood.root, degree)];
      for (let i = 1; i < length; i++) {
        let step = pick(mood.steps);
        if ((step < 0) !== (random() < mood.descend)) step = -step;
        let next = degree + step;
        let midi = degreeToMidi(scale, mood.root, next);
        if (midi < mood.register[0] || midi > mood.register[1]) {
          next = degree - step;
          midi = degreeToMidi(scale, mood.root, next);
        }
        if (midi < mood.register[0] || midi > mood.register[1]) {
          next = degree;
          midi = walk[i - 1];
        }
        degree = next;
        walk.push(midi);
      }
      endDegree = degree;
      // One note out of the register it has been walking in, alone and high —
      // AND IN THE MODE. It used to be a raw number drawn from a range, which
      // was survivable while only the pentatonic character had stars: five notes
      // in twelve are in that scale and the rest are its ninth and its fourth,
      // and none of those is wrong over a scale with no semitone in it. It stops
      // being survivable the moment the dorian character gets stars too, because
      // a chromatic note over a seven note mode is not a point of light, it is a
      // wrong note — and this world has one note sounding alone at the top of a
      // long silence, which is the most exposed place a wrong note could pick.
      if (star > 0 && mood.starRange && random() < star) {
        starAt = Math.floor(random() * walk.length);
        const wanted = between(mood.starRange[0], mood.starRange[1]);
        let degree = Math.round((wanted - mood.root) / 12 * scale.length);
        while (degreeToMidi(scale, mood.root, degree) < mood.starRange[0]) degree++;
        while (degreeToMidi(scale, mood.root, degree) > mood.starRange[1]) degree--;
        walk[starAt] = degreeToMidi(scale, mood.root, degree);
      }
      const intervals = [];
      for (let i = 1; i < walk.length; i++) intervals.push(walk[i] - walk[i - 1]);
      signature = intervals.join(',');
      if (!recent.includes(signature)) { notes = walk; break; }
    }
    if (!notes) {
      collisions++;
      notes = [degreeToMidi(scale, mood.root, centreDegree)];
      signature = '';
    }
    recent.push(signature);
    if (recent.length > MEMORY) recent.shift();
    return { notes, signature, starAt, endDegree };
  }

  /**
   * THE SECOND NOTE OF A DYAD, chosen rather than picked.
   *
   * A dyad used to be "the note, plus or minus one of these intervals", which is
   * correct harmonically and says nothing about the line the lower note is
   * making. Two dyads running on the same interval are two voices moving in
   * parallel by a perfect interval, which is the oldest prohibition there is and
   * is audible even here: it stops sounding like a hand holding two notes and
   * starts sounding like one note with a copy stapled under it.
   *
   * So the pool is the character's intervals AND their inversions — all perfect,
   * so the harmony is unchanged — and among the candidates that fit the register,
   * the one that is chosen is the one nearest where this voice last was, with the
   * interval that was just used ruled out and contrary motion preferred.
   */
  function dyadFor(midi, previous) {
    const pool = [];
    for (const interval of mood.dyadOf) {
      for (const value of [interval, -interval,
        interval > 0 ? interval - 12 : interval + 12]) {
        if (value !== 0 && !pool.includes(value)) pool.push(value);
      }
    }
    let best = null;
    for (const interval of pool) {
      const other = midi + interval;
      if (other < mood.register[0] || other > mood.register[1]) continue;
      // The strict prohibition: never the same perfect interval twice running.
      if (interval === dyadInterval) continue;
      let cost = dyadVoice === null ? Math.abs(interval) : Math.abs(other - dyadVoice);
      if (previous !== null && dyadVoice !== null) {
        // Contrary motion, gently preferred. Two voices that always move the
        // same way are one voice.
        const melodyUp = midi > previous;
        const voiceUp = other > dyadVoice;
        if (melodyUp === voiceUp) cost += 2.5;
      }
      if (!best || cost < best.cost) best = { interval, other, cost };
    }
    if (!best) return null;
    dyadInterval = best.interval;
    dyadVoice = best.other;
    return best.other;
  }

  /**
   * WHETHER THERE IS A BOW UNDER THIS PHRASE, AND ON WHAT.
   *
   * The bowed voice is a slow second line and not a doubling: it holds one note
   * for the length of a phrase, chosen from the ground the phrase is standing on
   * — the root, the third or the fifth of the mode at the degree this phrase is
   * spoken from, which in either scale is a note that cannot be wrong against it.
   *
   * It is chosen the way a line is chosen and not the way a pedal is: nearest to
   * where the bow last was, never the same note three times running, and a
   * candidate a semitone or a major seventh from the phrase's first or highest
   * note is refused outright — those are the only two intervals in this texture
   * that would be heard as a mistake rather than as a colour.
   */
  function bowFor(baseDegree, notes, apexMidi) {
    if (!strings.ready) return null;
    // Whether there is a bow at all comes first, and which instrument second.
    // The other order lets the violin in on its own probability instead of on
    // its share of the bowed phrases, and a point of light that happens on half
    // the phrases is not a point of light.
    if (random() >= profile.bow) return null;
    const family = random() < profile.violino ? 'violino' : 'cello';
    const scale = SCALES[mood.scale];
    const wantCentre = family === 'violino' ? 78 : 46 + profile.shift;
    let best = null;
    for (const step of [0, 2, 4]) {
      let midi = degreeToMidi(scale, mood.root, baseDegree + step);
      while (midi < wantCentre - 6) midi += 12;
      while (midi > wantCentre + 6) midi -= 12;
      let bad = false;
      for (const against of [notes[0], apexMidi]) {
        const gap = Math.abs(midi - against) % 12;
        if (gap === 1 || gap === 11) bad = true;
      }
      if (bad) continue;
      let cost = bowVoice === null ? 0 : Math.abs(midi - bowVoice);
      if (midi === bowVoice && bowRepeats >= 1) cost += 40;
      if (!best || cost < best.cost) best = { midi, cost };
    }
    if (!best) return null;
    if (best.midi === bowVoice) bowRepeats++; else bowRepeats = 0;
    bowVoice = best.midi;
    return { midi: best.midi, family };
  }

  /** One phrase, put on the clock. Returns how long it occupies. */
  function schedulePhrase(at) {
    if (pending) {
      // A CHANGE OF STATE LANDS HERE AND NOWHERE ELSE, which is what makes it a
      // change on a phrase boundary rather than a change in the middle of one.
      // Nothing already scheduled is touched; what is continuous is ramped into
      // under whatever is still ringing.
      if (pending.night !== null) night = pending.night;
      if (pending.weather) weather = pending.weather;
      pending = null;
      computeProfile();
      applyColour(at, 0.4);
    }
    phraseId++;
    const scale = SCALES[mood.scale];
    const centre = Math.round((mood.centre + profile.shift - mood.root) / 12 * scale.length);
    const step = discourse.next({
      theme: profile.theme,
      width: profile.width,
      forms: profile.forms,
    });
    const wantCentre = mood.centre + profile.shift + step.lift * 12;

    let notes = null;
    let gaps = null;
    let signature = '';
    let starAt = -1;
    let apexAt = 0;
    let form = null;

    if (step.thematic) {
      const raw = step.degrees.map((d, i) => degreeToMidi(scale, mood.root, d)
        + step.octaves[i] * 12);
      const shift = placeShape(raw, wantCentre);
      if (shift !== null) {
        notes = raw.map((m) => m + shift);
        // The character's own step is the unit the proportions are multiplied
        // by, so the theme is slower in the wider character and faster under a
        // sky that is moving, without either of those being written down twice.
        const unit = (mood.spacing[0] + mood.spacing[1]) / 2 * profile.pace;
        gaps = step.gaps.map((g) => g * unit);
        apexAt = step.apex;
        form = step.form;
        const intervals = [];
        for (let i = 1; i < notes.length; i++) intervals.push(notes[i] - notes[i - 1]);
        signature = intervals.join(',');
        lastDegree = step.degrees[step.degrees.length - 1];
      }
    }
    let startDegree = centre;
    if (!notes) {
      // Free invention, in the arc's register and the arc's dynamic. Beginning
      // between the character's centre and wherever the last phrase ended.
      const from = lastDegree === null ? centre
        : Math.round(lerp(centre, lastDegree, 0.55));
      startDegree = from + step.lift * scale.length;
      const drawn = drawPhrase(startDegree);
      notes = drawn.notes;
      signature = drawn.signature;
      starAt = drawn.starAt;
      lastDegree = drawn.endDegree;
      gaps = [];
      for (let i = 1; i < notes.length; i++) {
        gaps.push(between(mood.spacing[0], mood.spacing[1]) * profile.pace);
      }
      let top = -Infinity;
      for (let i = 0; i < notes.length; i++) if (notes[i] > top) { top = notes[i]; apexAt = i; }
    }

    // A LONG PHRASE IS NOT A LOUD PHRASE. Five notes a second apart in a room
    // that rings for six seconds are five notes sounding together, and without
    // this a five note phrase measured four decibels over a three note one for
    // no musical reason at all — which is also what a pianist does not do.
    const density = (3 / Math.max(2, notes.length)) ** 0.35;
    // The draw that sets a whole phrase's weight, narrowed around its own mean
    // by however much the spread has been asked to close. See MIX.dynamicSpread.
    const middle = (mood.velocity[0] + mood.velocity[1]) / 2;
    const drawn = between(mood.velocity[0], mood.velocity[1]);
    const level = (middle + (drawn - middle) * MIX.dynamicSpread)
      * density * step.tension * profile.velocity;

    // How near the instrument is heard, moved over the arc. Chased rather than
    // set, so that what a listener gets is a slow breath across minutes; nobody
    // is meant to hear this happening.
    near = lerp(near, step.near, 0.55);
    applyNear(at, 1.4);

    // The bow, decided before the notes are laid out because it needs to know
    // where the phrase starts and where its top is, and scheduled with the note
    // it is attached to.
    const total = gaps.reduce((s, g) => s + g, 0);
    const baseDegree = step.thematic
      ? (step.transpose ?? 0) + step.lift * scale.length
      : startDegree;
    const bow = bowFor(baseDegree, notes, notes[apexAt]);

    let t = at;
    let previous = null;
    for (let i = 0; i < notes.length; i++) {
      // Human timing: a few tens of milliseconds either side of where the note
      // was meant to be. Applied to the sounding time and NOT to the running
      // clock, so the jitter does not accumulate into a drift.
      const jitter = (random() * 2 - 1) * MIX.timingMs / 1000;
      // A phrase leans away as it goes: the last note of a thought is quieter
      // than the first — except at the apex of the theme, which is the note the
      // whole shape is aimed at and is allowed to be the loudest thing in it.
      // A star is a POINT OF LIGHT and not a stab: struck softly, which is both
      // what the picture wants and what keeps the loudest visits from landing
      // eight decibels over the walker.
      const lean = 1 - 0.16 * (i / Math.max(1, notes.length - 1));
      const weight = (step.thematic && i === apexAt ? 1.14 : 1)
        * (i === starAt ? 0.70 : 1);
      const velocity = clamp(
        level * lean * weight * (1 + (random() * 2 - 1) * MIX.velocityJitter),
        0.05, 1,
      );
      const when = Math.max(at, t + jitter);
      const role = (() => {
        if (i === starAt) return 'stella';
        if (!step.thematic) return 'libera';
        if (i === apexAt) return 'apice';
        if (i === 0) return 'attacco';
        if (i === notes.length - 1) return 'ultima';
        return 'tema';
      })();
      // The bow is hung on the phrase's first note, and it enters after it: an
      // arco under a piano arrives once the hammer has already been heard, or it
      // is not underneath anything.
      const sustain = (bow && i === 0) ? {
        midi: bow.midi,
        family: bow.family,
        at: when + between(0.25, 0.60),
        until: at + total + between(0.30, 1.20),
        level: clamp(level * 2.1, 0.1, 1.4),
      } : null;
      playNote(notes[i], when, velocity, { role, form, sustain });
      if (random() < mood.dyad * profile.dyad) {
        const other = dyadFor(notes[i], previous);
        if (other !== null) {
          const roll = between(MIX.rollMs[0], MIX.rollMs[1]) / 1000;
          playNote(other, Math.max(at, t + jitter + roll), velocity * 0.72,
            { role: 'bicordo', form, phrase: phraseId });
        }
      }
      previous = notes[i];
      if (i < gaps.length) t += gaps[i];
    }
    const span = t - at;
    log.push({
      at: at - openedAt,
      signature,
      notes: notes.slice(),
      span,
      form,
      station: step.station,
      transpose: step.thematic ? step.transpose : null,
      stretch: step.thematic ? +step.stretch.toFixed(2) : null,
      lift: step.lift,
      bow: bow ? bow.family : null,
      breath: step.breath,
    });
    return { span, breath: step.breath };
  }

  const api = {
    get character() { return current; },
    get characterLabel() { return mood.label; },
    get ready() { return ready; },
    get output() { return out; },
    get strings() { return strings; },

    /** Which of the two, live. Anything already sounding is left to finish. */
    setCharacter(next) {
      if (!CHARACTERS[next]) return current;
      current = next;
      mood = CHARACTERS[next];
      applyColour(context.currentTime, 0.25);
      return current;
    },

    /**
     * WHAT THE WORLD IS DOING, in one word.
     *
     * `giorno` `notte` `pioggia` `startrail`. It is honoured at the next phrase
     * boundary and never in the middle of one, which is the whole reason it is a
     * request rather than a setting: everything already sounding was scheduled
     * under the old state, and the way to change a state without a seam is to
     * let what is ringing finish being what it was.
     *
     * Nothing here changes what is played. The theme is the theme in all four.
     */
    setMood(name) {
      const asked = MOODS[name];
      if (!asked) return api.mood;
      pending = { night: asked.night, weather: asked.weather };
      return name;
    },
    get mood() {
      if (weather === 'pioggia') return 'pioggia';
      if (weather === 'startrail') return 'startrail';
      return night >= 0.5 ? 'notte' : 'giorno';
    },
    get moodLabel() { return MOODS[api.mood].label; },

    /**
     * Nought is day, one is night: slower, lower, and darker.
     *
     * The continuous half of the same control — the weather is a state and the
     * light is not, so this stays a number and stays useful. Applied at the next
     * phrase boundary, like everything else about a state.
     */
    setNight(value) {
      pending = { night: clamp(value, 0, 1), weather: pending ? pending.weather : weather };
      return clamp(value, 0, 1);
    },
    get night() { return night; },

    /**
     * HOW HARD THE WIND IS BLOWING, from nought to one.
     *
     * The bowed voice breathes with the gusts: a little more of it, a little
     * more open, and holding on longer after the phrase has gone. It is the one
     * thing in this world that the air and the music can plausibly share.
     *
     * NEUTRAL BY DEFAULT AND SAFE EITHER WAY. The state belongs to the unit that
     * owns the wind and this side never reaches for it; at nought — which is
     * where it stays unless somebody pushes — the voice behaves exactly as it
     * was built to. Safe to call every frame: it is smoothed, and it ignores a
     * value that has not meaningfully moved.
     */
    setWindGust(value) { return strings.setWindGust(value); },
    get windGust() { return strings.windGust; },

    /**
     * Whether it should be playing at all. Off disconnects the room from the
     * bus, which is what stops a network of delays being computed for nobody.
     */
    setActive(on, notBefore = 0) {
      if (on === active) return;
      active = on;
      if (on) { out.connect(destination); nextPhraseAt = notBefore; } else { out.disconnect(); }
    },

    /** Asks for the package. Call inside the gesture that opened the world. */
    load,

    /**
     * The clock. Everything is scheduled ahead on the audio clock, so a slow or
     * a skipped frame moves nothing: this only has to be called often enough to
     * stay inside the lookahead.
     *
     * It takes the time rather than reading it, because the same function has to
     * run against an offline context — where nothing has a current time until it
     * has already been rendered — and rendering the real engine is the only
     * honest way to hear it outside the world.
     */
    pump(now, lookahead = 1.6) {
      if (!active || !ready) return;
      const from = performance.now();
      if (nextPhraseAt === 0) {
        // The first phrase is promised from the gesture, not from whenever the
        // bytes finished decoding. If decoding took longer than the promise the
        // phrase is already overdue and sounds as soon as it can.
        nextPhraseAt = Math.max(openedAt + api.firstDelayS, readyAt + 0.12);
      }
      while (nextPhraseAt < now + lookahead) {
        if (nextPhraseAt < now) nextPhraseAt = now + 0.05;
        const { span, breath } = schedulePhrase(nextPhraseAt);
        // AND NO BREATH IS EVER LONGER THAN THIS, whatever the character, the
        // weather and the end of an arc multiply together to. The foundation
        // shipped breaths of eight to eighteen seconds and they were approved at
        // that length; three multipliers stacked on them reached thirty-five,
        // and thirty-five seconds of no piano is not a breath, it is a listener
        // deciding the music has stopped. The cap binds rarely — it is the tail
        // of a distribution whose middle is unchanged — and it binds hardest in
        // exactly the states that would otherwise drift furthest.
        const breathe = Math.min(
          MAX_BREATH,
          between(mood.gap[0], mood.gap[1]) * profile.gap * breath,
        );
        nextPhraseAt += span + breathe;
      }
      costUs = (performance.now() - from) * 1000;
      if (costUs > peakUs) peakUs = costUs;
    },

    /** When the world opened, so every promise can be counted from one event. */
    open(at) { openedAt = at; nextPhraseAt = 0; },

    firstDelayS: 2.5,

    /** Everything the measurement needs, and nothing the world needs. */
    stats() {
      const free = log.filter((p) => !p.form);
      const themed = log.filter((p) => p.form);
      const signatures = free.map((p) => p.signature);
      return {
        character: current,
        label: mood.label,
        mood: api.mood,
        night,
        weather,
        ready,
        readyS: ready ? readyAt - openedAt : null,
        firstNoteS: firstNoteAt === null ? null : firstNoteAt - openedAt,
        phrases: log.length,
        notes: scheduled,
        slots: slots.length,
        // The foundation's guarantee, unchanged and still over the phrases it
        // was ever a claim about: the free ones.
        free: free.length,
        unique: new Set(signatures).size,
        collisions,
        theme: {
          statements: themed.length,
          share: log.length ? +(themed.length / log.length).toFixed(3) : 0,
          forms: new Set(themed.map((p) => p.form)).size,
          realisations: new Set(themed.map(
            (p) => `${p.form}/${p.transpose}/${p.lift}/${p.stretch}`,
          )).size,
          arcs: discourse.arcs,
        },
        bowed,
        strings: strings.stats(),
        costUs,
        peakUs,
        log: log.slice(),
      };
    },
  };

  // THE PANEL, and it is a panel and not a setting. Which state the world is in
  // is a question for the committente until the machine that owns the world's
  // weather exists, so `?mood=pioggia` opens in one and, with `mood` in the
  // address, K walks round the four without a reload — which is the only way to
  // judge them against each other in the same ears and the same minute. A page
  // without `mood` in its query never adds the listener at all, so a visitor
  // cannot change the weather by leaning on a key.
  function installPanel() {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    let asked = null;
    try {
      asked = new URLSearchParams(window.location.search).get('mood');
    } catch { return; }
    if (asked === null) return;
    const order = Object.keys(MOODS);
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'KeyK' || event.repeat) return;
      const next = order[(order.indexOf(api.mood) + 1) % order.length];
      api.setMood(next);
      console.info(`stato: ${next} — ${MOODS[next].label} (dal prossimo respiro)`);
    });
  }
  installPanel();

  return api;
}
