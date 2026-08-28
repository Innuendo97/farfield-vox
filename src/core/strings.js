// A bowed voice under the piano.
//
// WHAT THIS IS FOR. The piano in this world is a memory of an instrument heard
// across a distance; what it does not have is BREATH. A struck string can only
// decay, so every phrase falls away from its own first moment, and a texture
// made only of decays is a texture that is always leaving. A bowed note is the
// opposite shape — it can arrive slowly, stay, and be withdrawn — and one of
// them held under a phrase turns a sequence of departures into something that is
// also present. That is the entire brief here: presence, not melody. This voice
// never states the theme, never plays faster than one note a phrase, and is
// mixed to sit under the piano rather than beside it.
//
// AND IT DOES NOT KNOW WHAT MUSIC IS. It is handed notes — pitch, when, how
// long, how loud — and it turns them into sound. Which note, and whether there
// should be one at all, is decided where the mode and the register live, which
// is the generator. Two files, one model of the music: a string voice that chose
// its own pitches would need its own idea of the scale, and a second idea of the
// scale is a second piece of music playing quietly over the first.
//
// HOW A HELD NOTE IS MADE OUT OF A SHORT RECORDING. Every slot in the package is
// the STEADY MIDDLE of a bowed note and nothing else — no attack, because an
// arco under a piano must not have an edge, and no release, because the release
// has to last as long as a phrase does. The middle is cut so that its end runs
// seamlessly back into its beginning, and it is played as a loop under an
// envelope that does the arriving and the leaving. What a listener hears the
// length of is the envelope; what they hear the sound of is two and a bit
// seconds of a real section, going round.

/**
 * WHAT WAS SAMPLED.
 *
 * Eight notes of a cello section and three of a solo violin, soft layer only —
 * a section bowed hard is a different instrument, not the same one louder, and
 * this voice is never anything but soft.
 *
 * THE PITCHES ARE MEASURED AND NOT NAMED. The library that these came from
 * writes its cello an octave below the convention this world counts in and its
 * violin inside it, in the same download, which is exactly why a name is not
 * evidence. Every fundamental here was read off the recording.
 *
 * `loop` is not the same for every note, and that is deliberate. A loop joins a
 * moment to a moment one loop-length earlier, and a player's vibrato — or, in a
 * section, the beating between two players a few cents apart — is at a different
 * point of its cycle at those two moments unless the loop holds a whole number
 * of cycles. A crossfade hides a step in the waveform. It does not hide a step
 * in the wobble, and a step in the wobble once every two seconds is the thing
 * that makes a sampled string sound sampled. So each note's loop is a whole
 * number of ITS OWN periodicity, measured from the recording.
 */
export const STRINGS = {
  cello: {
    midi: [36, 40, 43, 47, 50, 53, 57, 60],
    loop: [2.160, 2.300, 2.200, 2.200, 2.240, 2.200, 2.240, 2.200],
    // Slightly to one side. A cello is one player in one place, and the piano is
    // already spread across the middle: this is what stops the two being the
    // same object.
    pan: -0.16,
    // How far the sampler may stretch before it folds by octaves instead. Two
    // semitones on a dark sustained tone is inaudible; four is a different
    // instrument.
    stretch: 2.2,
  },
  violino: {
    // High and few. This voice exists for one state of the world and one moment
    // of an arc, and a note of it is a point of light rather than a line.
    midi: [72, 76, 81],
    loop: [2.240, 2.200, 2.160],
    pan: 0.21,
    stretch: 2.6,
  },
  // Silence in front of every slot, so the constant the encoder shifts the whole
  // file by can be measured off a step instead of guessed. Cheap: silence is
  // nearly free in a compressed file.
  lead: 0.12,
  // AND MATERIAL PAST THE END OF THE LOOP, which matters more than it looks.
  // A loop is seamless because the sample after the last one is the first one;
  // if the runtime's idea of where the loop starts is a few milliseconds out,
  // the far end of it lands in whatever follows — and what follows a slot is the
  // next slot's silence, so a two millisecond error becomes a two millisecond
  // hole once every two seconds. Every slot therefore carries a fifth of a
  // second of the cycle CONTINUING past its own end, and the runtime deliberately
  // enters a little way in. Any start inside that margin is still a seamless
  // loop, so the measurement no longer has to be exact, only close.
  guard: 0.20,
  bias: 0.06,
  files: [
    {
      name: 'archi-1.m4a',
      slots: [
        ['cello', 0], ['cello', 1], ['cello', 2], ['cello', 3],
        ['cello', 4], ['cello', 5], ['cello', 6], ['cello', 7],
        ['violino', 0], ['violino', 1], ['violino', 2],
      ],
    },
  ],
};

export const BOW = {
  // What the whole voice is worth against the piano it sits under. Measured, not
  // chosen: see the level section of the unit's notes.
  gain: 0.60,
  // The violin is quieter still, and not by a little. It is at the top of the
  // range where an ear is most sensitive, and it is meant to be noticed at the
  // edge of hearing rather than heard.
  violinoGain: 0.30,
  // The top the bowed voice is heard through, before the world's own distance.
  // Darker than the piano's on purpose: the piano is the thing being listened
  // to and this is the air around it.
  tone: 1700,
  // How the note arrives and how it goes. A bow reaching speed over more than a
  // second has no attack an ear can point at, which is the whole intent — and
  // this is what is ASKED FOR rather than what is always got: a phrase too short
  // to hold this much arrival gets a shorter one instead of no bow at all. See
  // `play`.
  attack: [1.05, 1.75],
  release: [2.6, 4.4],
  // How much of it goes to the room the piano is in. More than the piano's
  // share: a sustained tone in a long room IS the room, and this voice is
  // supposed to read as distance rather than as an instrument.
  dry: 0.34,
  wet: 1.15,
  // The steadiest part of a bowed note still wanders, and two notes started at
  // the same point of the same loop sound like one note played twice. Every
  // entry starts somewhere else in the loop.
  offsetJitter: 0.75,
};

function clamp(v, low, high) { return v < low ? low : (v > high ? high : v); }

const FLAT_Q_DB = -3.01;

/**
 * How far the encoder moved the sprite from where the layout says it is.
 *
 * Each slot opens with silence and then a sustained tone at full level, which is
 * the easiest onset there is to find; the answer is how far that onset sits from
 * the end of the silence, and the MEDIAN of them, because one slot fooling a
 * threshold must not move the whole file.
 *
 * THE SEARCH HAS TO REACH PAST THE SILENCE. A window shorter than the lead finds
 * nothing at all and reports nought — which is very close to the right answer
 * here and would therefore never be noticed. It runs to twice the lead, so a
 * genuine nought is a measurement and not a miss.
 */
function spriteDelay(buffer, offsets, lengths) {
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  const lead = STRINGS.lead * rate;
  const block = Math.round(rate * 0.005);
  const found = [];
  const levelAt = (from) => {
    let sum = 0;
    for (let i = from; i < from + block; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / block);
  };
  for (let k = 0; k < offsets.length; k++) {
    const at = Math.round(offsets[k] * rate);
    const end = Math.min(data.length, at + Math.round(lengths[k] * rate)) - block * 2;
    if (end <= at) continue;
    let top = 0;
    for (let i = at; i < end; i += block) top = Math.max(top, levelAt(i));
    if (top <= 0) continue;
    const threshold = top * 0.10;
    const limit = Math.min(end, at + Math.round(lead * 2));
    for (let i = at; i < limit; i += block) {
      // A BOW AND NOT A BLEED. The end of the slot before this one is a hard cut
      // and an encoder smears it forwards, so the first sample over a threshold
      // is not necessarily the note: the note is the first block over it that is
      // still over it a moment later, and a smear never is.
      if (levelAt(i) > threshold && levelAt(i + block) > threshold) {
        found.push(i - at - lead);
        break;
      }
    }
  }
  if (!found.length) return 0;
  found.sort((a, b) => a - b);
  return found[found.length >> 1] / rate;
}

/** A raised cosine from `from` to `to`, which is what a bow does and a ramp does not. */
function swell(from, to, points = 48) {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = i / (points - 1);
    curve[i] = from + (to - from) * (0.5 - 0.5 * Math.cos(Math.PI * x));
  }
  return curve;
}

/**
 * The bowed voice.
 *
 * @param {object} options
 * @param {BaseAudioContext} options.context
 * @param {AudioNode} options.destination  where the dry part goes — the same
 *   output the piano's own dry part goes to, so one music level moves both
 * @param {AudioNode} options.room         the room the piano is already in. There
 *   is one place in this world, not two
 * @param {string} options.base            where the package is served from
 */
export function createStrings({
  context, destination, room, base = './', random = Math.random,
}) {
  const between = (a, b) => a + random() * (b - a);
  // A rumble cut before anything else. The room's comb bank has a gain of about
  // twenty-two at nought hertz and a decoder hands back a little sub-audio
  // wander in everything: a sustained tone feeding that for as long as a phrase
  // lasts is the one source in this world with the patience to pile it up.
  const cut = context.createBiquadFilter();
  cut.type = 'highpass';
  cut.frequency.value = 42;
  cut.Q.value = FLAT_Q_DB;
  const tone = context.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = BOW.tone;
  tone.Q.value = FLAT_Q_DB;
  const bus = context.createGain();
  bus.gain.value = BOW.gain;
  cut.connect(tone).connect(bus);

  const dry = context.createGain();
  dry.gain.value = BOW.dry;
  bus.connect(dry).connect(destination);
  const send = context.createGain();
  send.gain.value = BOW.wet;
  bus.connect(send);
  if (room) send.connect(room);

  const slots = new Map();
  const files = STRINGS.files.map((f) => ({ ...f, buffer: null, delay: 0 }));
  let ready = false;
  let windGust = 0;
  // What the world's state has asked of this voice, kept so that the wind and
  // the weather can move the same two numbers without either erasing the other.
  const colour = { tone: 1, level: 1 };
  let played = 0;
  let voices = 0;
  let peakVoices = 0;

  function addSlots(file) {
    let at = 0;
    const offsets = [];
    const lengths = [];
    for (const [family, index] of file.slots) {
      const length = STRINGS[family].loop[index];
      offsets.push(at);
      lengths.push(STRINGS.lead + length + STRINGS.guard);
      if (!slots.has(family)) slots.set(family, []);
      slots.get(family).push({
        midi: STRINGS[family].midi[index],
        file,
        // Where the loop starts, before the constant the encoder adds and before
        // the margin that makes the constant not have to be exact.
        offset: at + STRINGS.lead + STRINGS.bias,
        length,
      });
      at += STRINGS.lead + length + STRINGS.guard;
    }
    file.delay = spriteDelay(file.buffer, offsets, lengths);
  }

  async function load() {
    // Lowest priority in the world, and nothing waits on it. The piano's first
    // note is a promise this unit must not touch: until these bytes land the
    // bowed voice simply does not answer, and a walker who never hears it in the
    // first ten seconds has heard the world it was designed for anyway.
    for (const file of files) {
      try {
        const response = await fetch(`${base}audio/strings/${file.name}`, { priority: 'low' });
        if (!response.ok) throw new Error(`${file.name} (${response.status})`);
        file.buffer = await context.decodeAudioData(await response.arrayBuffer());
        addSlots(file);
        ready = true;
      } catch (error) {
        console.warn(`archi non caricati: ${error.message}`);
      }
    }
  }

  function slotFor(family, midi) {
    const list = slots.get(family);
    if (!list || !list.length) return null;
    let best = list[0];
    for (const slot of list) {
      if (Math.abs(midi - slot.midi) < Math.abs(midi - best.midi)) best = slot;
    }
    return best;
  }

  /**
   * One bowed note.
   *
   * @param {object} note
   * @param {number} note.midi   what to play, folded into what was sampled
   * @param {number} note.at     when the bow starts moving, on the audio clock
   * @param {number} note.until  when it starts to leave
   * @param {number} note.level  how much of it, before the voice's own trim
   * @param {string} note.family which instrument
   */
  function play({
    midi: wanted, at, until, level = 1, family = 'cello',
  }) {
    if (!ready) return false;
    const table = STRINGS[family];
    const list = slots.get(family);
    if (!table || !list || !list.length) return false;
    // Folded by octaves into what exists rather than stretched into it, and then
    // only stretched the last couple of semitones. An octave is the one
    // transposition that leaves a note the note it was.
    let midi = wanted;
    const low = Math.min(...list.map((s) => s.midi));
    const high = Math.max(...list.map((s) => s.midi));
    while (midi > high + table.stretch) midi -= 12;
    while (midi < low - table.stretch) midi += 12;
    const slot = slotFor(family, midi);
    if (!slot) return false;

    // The wind lengthens the leaving without lengthening the arriving: a gust
    // does not make a bow start sooner, it makes the note hang on after it.
    const release = between(BOW.release[0], BOW.release[1]) * (1 + 0.5 * windGust);
    const hold = until - at;
    // A SHORT PHRASE GETS A SHORTER BOW, NOT NO BOW.
    //
    // This used to refuse outright anything that could not hold the full arrival
    // — and the state that wants the most bow of all is also the state that
    // draws the shortest phrases, because "sparser" is spelled with the two-note
    // and three-note forms. The two rules fought, and rain came out with no
    // cello in it at all: a fifth of a chance per phrase, four phrases, and a
    // panel file that demonstrated the opposite of what that state is for.
    //
    // So the arrival is fitted to the room it has. Half of the phrase, at most
    // what was drawn, and never under this floor — below which a bow does have
    // an edge, and an edge is the one thing this voice may not have.
    const attack = Math.max(0.45, Math.min(between(BOW.attack[0], BOW.attack[1]), hold * 0.55));
    if (hold < attack + 0.25) return false;

    const source = context.createBufferSource();
    source.buffer = slot.file.buffer;
    source.playbackRate.value = 2 ** ((midi - slot.midi) / 12);
    const start = slot.offset + slot.file.delay;
    source.loop = true;
    source.loopStart = start;
    source.loopEnd = start + slot.length;

    const gain = context.createGain();
    gain.gain.value = 0;
    const trim = family === 'violino' ? BOW.violinoGain : 1;
    const top = clamp(level * trim, 0, 4);
    // Both halves of the envelope are curves and neither is a ramp, because a
    // ramp into a sustained tone has a corner in it and a corner is an attack.
    // They are also both explicit curves rather than a decaying target, so that
    // the note ends at nought exactly when it is meant to — offline, where all
    // the measurement of this world happens, a tail that never quite arrives is
    // a tail that is still there at the end of the render.
    gain.gain.setValueCurveAtTime(swell(0, top), at, attack);
    gain.gain.setValueCurveAtTime(swell(top, 0), until, release);

    const pan = context.createStereoPanner();
    pan.pan.value = table.pan;
    source.connect(gain).connect(pan).connect(cut);
    // Entering the loop somewhere other than its head, so two notes on the same
    // string are not the same two seconds twice.
    source.start(at, start + random() * BOW.offsetJitter * slot.length);
    source.stop(until + release + 0.05);
    voices++;
    if (voices > peakVoices) peakVoices = voices;
    source.onended = () => { voices--; pan.disconnect(); };
    played++;
    return true;
  }

  return {
    get ready() { return ready; },
    get windGust() { return windGust; },
    load,
    play,

    /**
     * HOW HARD THE WIND IS BLOWING, from nought to one.
     *
     * DECLARED AND INERT. Nothing in this world drives this yet: the state it
     * wants belongs to the unit that owns the wind, and until that state is
     * handed over the default is nought and this voice behaves exactly as it was
     * built to. What it does when it is driven is make the bowed voice breathe
     * with the gusts — a little more of it, a little more open, and holding on
     * longer after the phrase has gone — which is the one thing in this world
     * that the air and the music could plausibly share.
     *
     * Safe to call every frame: it is smoothed here, not by the caller.
     */
    setWindGust(value, when = context.currentTime) {
      const wanted = clamp(value, 0, 1);
      // CALLED EVERY FRAME, so it is allowed to do nothing. The world hands this
      // the gust it is currently blowing sixty times a second; writing two ramps
      // each time would put a hundred and twenty automation events a second onto
      // two parameters for the sake of a number that moves over seconds. The
      // comparison is against the value LAST APPLIED and not the last seen, so a
      // gust that creeps up in hundredths still gets there.
      if (Math.abs(wanted - windGust) < 0.02 && !(wanted === 0 && windGust !== 0)) return windGust;
      windGust = wanted;
      bus.gain.setTargetAtTime(BOW.gain * colour.level * (1 + 0.34 * windGust), when, 0.9);
      tone.frequency.setTargetAtTime(
        clamp(BOW.tone * colour.tone * (1 + 0.38 * windGust), 200, 18000), when, 0.9,
      );
      return windGust;
    },

    /**
     * How dark and how distant, from the state the world is in.
     *
     * The time is handed in rather than read, for the reason every ramp in this
     * package is: offline there is no current time to read, and a change placed
     * at nought seconds is a change that did not happen where it was meant to.
     */
    setColour({ tone: hz = 1, level = 1, wet = 1 } = {}, when = context.currentTime) {
      colour.tone = hz;
      colour.level = level;
      tone.frequency.setTargetAtTime(
        clamp(BOW.tone * hz * (1 + 0.38 * windGust), 200, 18000), when, 0.5,
      );
      bus.gain.setTargetAtTime(BOW.gain * level * (1 + 0.34 * windGust), when, 0.5);
      send.gain.setTargetAtTime(BOW.wet * wet, when, 0.5);
    },

    stats() {
      return {
        ready, played, peakVoices, windGust, slots: slots.size ? [...slots.values()].reduce((n, l) => n + l.length, 0) : 0,
      };
    },
  };
}
