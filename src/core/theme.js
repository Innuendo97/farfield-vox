// The theme of Farfield, and the discourse that develops it.
//
// WHY THERE IS A SECOND FILE AND WHAT IS IN IT. `melody.js` knows about sound —
// samples, gain, a room, a clock. This one knows about music and nothing else:
// there is not an audio node in it, not a second of time, not a frequency. It
// deals in SCALE DEGREES and in PROPORTIONS, and it hands back lists of both.
// That separation is not tidiness, it is what makes the theme portable: the same
// shape, spoken in a different mode, comes out as different intervals without a
// line of it being rewritten, and that is the whole reason one theme can live in
// two characters that share no notes.
//
// AND IT IS NOT A SECOND MODEL OF THE MUSIC. Nothing here decides when a note
// sounds or how loud; it decides WHAT, in degrees, and IN WHAT PROPORTION, and
// `melody.js` remains the only thing that puts anything on a clock.

/**
 * THE MOTIF.
 *
 * Five notes, and the reason for each of them.
 *
 *   0   where it sets out
 *  +4   a leap up — a fifth in the seven note mode, a minor seventh in the five
 *       note one. This is the call across a distance: an open interval, which is
 *       the sound of space rather than of a feeling about it
 *  +5   ONE DEGREE FURTHER, and this is the whole gesture. The leap alone is an
 *       open call; the extra step past it is the reaching that does not quite
 *       arrive, and it is the only stepwise motion in this entire world — which
 *       is exactly why it is heard as the signature rather than as passing. It
 *       is a RISING MAJOR SECOND in both modes, and it lands on the note each
 *       mode is characterised by: the major sixth of the dorian, which is the
 *       sound of remembering something fondly, and the octave of the pentatonic,
 *       which is the only arrival a scale with nothing to resolve can offer
 *  +2   a long fall away from the top, through a fourth or a fifth
 *  -1   and to rest a WHOLE TONE BELOW WHERE IT STARTED. This is the invariant
 *       worth more than any other in here: the last degree before the octave is
 *       ten semitones in BOTH scales, so the theme ends two semitones under its
 *       own first note in both characters, whatever the mode does in between.
 *       It never comes home; it comes to rest a little lower than it set out.
 *
 * THE RHYTHM IS HALF THE IDENTITY. There is no metre in this world — the walker
 * hears rubato over silence — so the rhythm here is not durations but
 * PROPORTIONS, multiplied at the last moment by whatever the character and the
 * mood say a step is worth. Short, short, LONG, medium: two notes reaching up
 * quickly, the top of the arch held while it is looked at, and a descent that
 * takes its time. The second gap is slightly longer than the first, which is the
 * hesitation before the reach, and it is deliberate rather than human — the
 * humanisation happens later and on top.
 */
export const MOTIF = {
  degrees: [0, 4, 5, 2, -1],
  gaps: [0.55, 0.70, 1.70, 1.05],
};

/**
 * THE FORMS THE THEME TAKES.
 *
 * Every one of them is a CONTIGUOUS RUN of the motif's positions, which is what
 * keeps the rhythm honest: a fragment does not get to invent its own timing, it
 * inherits the gaps that sit between the positions it kept. That is why the head
 * still sounds like the head and the tail still sounds like the tail — they are
 * not three notes and two notes, they are the first three and the last two OF
 * THIS, at the speeds this has.
 *
 *   at      which positions of the motif this form occupies
 *   degrees what it does there — the same shape, or the shape altered
 *   lift    octaves added per note, for the forms that break across registers
 */
export const FORMS = {
  // The thesis. Everything else is heard against this.
  intera: { at: [0, 1, 2, 3, 4], degrees: [0, 4, 5, 2, -1] },
  // The one that comes home, and it is rare on purpose: this world withholds
  // resolution, and a resolution withheld is only felt if it happens sometimes.
  risolta: { at: [0, 1, 2, 3, 4], degrees: [0, 4, 5, 2, 0] },
  // The rise alone, left standing on the top note. A question with no second
  // half — the most recognisable three notes there are, because they are the
  // three that carry the leap and the step.
  testa: { at: [0, 1, 2], degrees: [0, 4, 5] },
  // The fall alone, entered from above: a memory already in progress.
  coda: { at: [2, 3, 4], degrees: [5, 2, -1] },
  // Two notes and the end of it.
  sospiro: { at: [3, 4], degrees: [2, -1] },
  // THE MIRROR. Every step negated: it falls where the theme rises and rises
  // where the theme falls, and by the same arithmetic that puts the theme a whole
  // tone BELOW its first note, this one ends a whole tone ABOVE. Same material,
  // opposite outcome — which is why it belongs at the top of an arc and nowhere
  // else.
  inversa: { at: [0, 1, 2, 3, 4], degrees: [0, -4, -5, -2, 1] },
  // The reach goes one degree past where it should. The apex overshoots, and the
  // fall from it is longer.
  apertura: { at: [0, 1, 2, 3, 4], degrees: [0, 4, 6, 2, -1] },
  // The descent breaks somewhere else on the way down and the ending is the
  // same: the shape is recognised by its outline, not by its middle.
  sospesa: { at: [0, 1, 2, 3, 4], degrees: [0, 4, 5, 3, -1] },
  // Broken across registers: the rise where it belongs, the fall two octaves
  // above it. The theme stops being a line and becomes two places.
  lontana: {
    at: [0, 1, 2, 3, 4], degrees: [0, 4, 5, 2, -1], lift: [0, 0, 0, 2, 2],
  },
};

/**
 * THE ARC, which is the theme again at the scale of minutes.
 *
 * Five stations, each holding one or two phrases, and between them the world's
 * ordinary breathing: an arc is two to four minutes long, which is the span over
 * which a listener can feel a shape without being asked to remember one.
 *
 *   tension   what the phrase is worth, as a multiplier on the character's
 *             dynamic. The RETURN is the quietest thing in the arc — the memory
 *             comes back smaller than it arrived, which is the entire feeling
 *             this world is for
 *   lift      octaves, so the shape is planned in registers and not left to a
 *             random walk to wander into
 *   near      how close the instrument is heard: the top of the arc is the least
 *             distant moment and the return is the most. The distance itself
 *             breathes, over minutes, and nobody is meant to notice it happening
 *   theme     how likely this station's phrase is the theme rather than free
 *             invention. Dispersal is mostly free — if everything were thematic
 *             the theme would stop being one
 *   stretch   augmentation and diminution, as a factor on the motif's own gaps
 *   forms     what the theme is allowed to be here
 */
export const ARC = [
  {
    name: 'enunciazione',
    phrases: [1, 1],
    tension: 0.94,
    lift: 0,
    near: 1.0,
    theme: 1.0,
    stretch: [1.0, 1.08],
    forms: ['intera'],
  },
  {
    name: 'sviluppo',
    phrases: [1, 2],
    tension: 1.02,
    lift: 0,
    near: 1.04,
    theme: 0.80,
    stretch: [0.82, 1.04],
    forms: ['testa', 'apertura', 'sospesa', 'intera', 'coda'],
  },
  {
    name: 'culmine',
    phrases: [1, 1],
    tension: 1.16,
    lift: 1,
    near: 1.12,
    theme: 0.88,
    // Broad. The top of an arc is not the fast part — a climax that hurries is a
    // climax nobody arrives at.
    stretch: [1.45, 1.85],
    forms: ['inversa', 'apertura', 'intera', 'lontana'],
  },
  {
    name: 'dispersione',
    phrases: [1, 2],
    tension: 0.86,
    lift: 0,
    near: 0.95,
    theme: 0.38,
    stretch: [1.05, 1.35],
    forms: ['sospiro', 'coda', 'testa'],
  },
  {
    name: 'ritorno',
    phrases: [1, 1],
    tension: 0.78,
    lift: -1,
    near: 0.89,
    theme: 1.0,
    stretch: [1.12, 1.34],
    // Nearly always the theme entire, because the return IS the payment for the
    // two minutes before it — but not quite always. `sospesa` has the same
    // outline and breaks differently on the way down, so the one arc in four
    // that ends with it is recognised as the return and is not the return you
    // were expecting, which is the difference between a shape coming back and a
    // shape being replayed.
    forms: ['intera', 'intera', 'intera', 'sospesa'],
  },
];

// How often the return is the form that resolves. One arc in six or so: often
// enough that a walker who stays half an hour hears it land two or three times,
// rare enough that it is an event when it does.
const RESOLVES = 0.17;

// After the return, a breath longer than any inside the arc. The end of a
// thought is not the same length of silence as a comma in one — but only a
// little longer, because the world this plays in already has silences measured
// in tens of seconds and the caller puts a ceiling over the whole sum.
export const ARC_BREATH = 1.30;

// WHY THE SOURCE OF RANDOMNESS IS AN ARGUMENT AND NOT `Math.random`.
//
// Everything about this world's level is a distribution, and a distribution is
// measured by comparing populations — which works until the effect being looked
// for is smaller than the spread. Twelve visits of this engine spread over
// sixteen decibels, so differencing two medians of twelve reported that adding a
// whole second instrument made the music THREE AND A HALF DECIBELS QUIETER. It
// is not a mixing problem, it is an experiment that cannot see what it is
// pointed at.
//
// The fix is to make two renders comparable rather than merely similar: hand the
// engine its randomness, and the same seed gives the same phrases, so the only
// difference left between two renders IS the thing being changed. The default is
// `Math.random`, so the world is untouched and nothing about a visit becomes
// predictable.
function source(random) {
  return {
    between: (a, b) => a + random() * (b - a),
    pick: (list) => list[Math.floor(random() * list.length)],
  };
}

/**
 * A form, transposed and stretched, as degrees and proportions.
 *
 * `transpose` is DIATONIC — degrees, not semitones — so a transposed statement
 * is not the same intervals moved sideways but the same shape spoken from a
 * different place in the mode, with the intervals the mode gives it there. That
 * is what makes a mode sound like a mode instead of like a key.
 */
export function realise(name, { transpose = 0, stretch = 1, lift = 0 } = {}) {
  const form = FORMS[name] || FORMS.intera;
  const degrees = form.degrees.map((d) => d + transpose);
  const octaves = form.degrees.map((_, i) => lift + (form.lift ? form.lift[i] : 0));
  const gaps = [];
  for (let i = 0; i + 1 < form.at.length; i++) {
    let sum = 0;
    for (let p = form.at[i]; p < form.at[i + 1]; p++) sum += MOTIF.gaps[p];
    gaps.push(sum * stretch);
  }
  // Where the top of the shape is, once the octave breaks are counted in. The
  // apex is the note a second voice leans on and the note a phrase is weighted
  // towards, so it is worked out here rather than guessed downstream.
  let apex = 0;
  let best = -Infinity;
  for (let i = 0; i < degrees.length; i++) {
    const height = degrees[i] + octaves[i] * 100;
    if (height > best) { best = height; apex = i; }
  }
  return {
    form: name, degrees, octaves, gaps, apex,
  };
}

/**
 * The thing that decides what happens next, phrase by phrase.
 *
 * It holds one arc at a time and walks its stations. What it hands back is a
 * PLAN and not a phrase — no pitches, no seconds — because turning degrees into
 * notes needs the mode and the register, and those belong to the character.
 */
export function createDiscourse({ random = Math.random } = {}) {
  const { between, pick } = source(random);
  let arc = null;
  let station = 0;
  let left = 0;
  let held = 0;
  let arcs = 0;
  const recent = [];

  /**
   * A NEW ARC, AND ITS ITINERARY IS THE MOTIF ITSELF.
   *
   * The sequence of transpositions the five stations are spoken from is the
   * motif's own degrees, scaled down and rounded, with the last forced home. So
   * the shape of the two minutes is the shape of the five seconds: up, further
   * up, away, back. A listener does not hear this as a structure — nobody hears
   * a key plan — but it is the reason the minutes hang together rather than
   * merely following one another, and it costs one line.
   */
  function newArc(width) {
    const scale = pick([0.4, 0.6, 0.8]);
    const itinerary = MOTIF.degrees.map((d) => Math.round(d * scale * width));
    itinerary[itinerary.length - 1] = 0;
    arc = { itinerary, resolves: random() < RESOLVES };
    station = 0;
    left = 0;
    arcs++;
  }

  return {
    get arcs() { return arcs; },
    get station() { return arc ? ARC[station].name : null; },

    /**
     * The next phrase's plan.
     *
     * @param {object} mood  the multipliers the world's state imposes: how
     *   thematic, how stretched, how wide in register. Everything else about a
     *   mood is sound and is applied where sound is.
     */
    next(mood = {}) {
      const width = mood.width ?? 1;
      if (!arc) newArc(width);
      if (left <= 0) {
        const opening = ARC[station];
        held = opening.phrases[0]
          + Math.floor(random() * (opening.phrases[1] - opening.phrases[0] + 1));
        left = held;
      }
      const plan = ARC[station];
      const first = left === held;
      // WHICHEVER PHRASE OF THE STATION THIS IS, the first one carries the
      // theme and a second one is far more likely to be free: a station that
      // says the theme twice running says it twice running, and the point of a
      // second phrase in a station is the air around the first.
      const density = (mood.theme ?? 1) * plan.theme * (first ? 1 : 0.45);
      const thematic = random() < density;
      const last = station === ARC.length - 1;

      let step;
      if (thematic) {
        const frame = plan.theme >= 1;
        // The weather may add forms to the stations in the middle and NEVER to
        // the frame. A state of the world re-dresses the theme; it does not get
        // to replace the sentence the arc opens and closes with, and a star
        // trail whose arcs began with the mirror instead of the theme was a star
        // trail with no theme in it — which is the one thing the brief for these
        // states rules out in capitals.
        const forms = frame || !mood.forms ? plan.forms : plan.forms.concat(mood.forms);
        const transpose = arc.itinerary[station];
        // NEVER THE SAME WAY TWICE, and this is the restatement of the
        // foundation's one guarantee rather than an exception to it. A theme
        // that returns is a theme that repeats an interval sequence — that is
        // what a theme IS — so what must not repeat is the REALISATION: the
        // form, where it is spoken from, which octave, and how broad.
        //
        // EXCEPT AT THE TWO STATIONS THAT ARE THE FRAME. The opening statement
        // and the return are supposed to be the same thing twice: that is the
        // entire function of an anchor, and a listener who has been here five
        // minutes recognises the theme because those two came round unchanged.
        // Applying the memory to them cost this world its architecture — the
        // opening statement collided with the last arc's opening statement,
        // fell through to free invention, and three arcs out of four began with
        // no theme in them at all. They are still WRITTEN INTO the memory, so
        // that the stations in between do not accidentally say what the frame
        // has just said. (Which stations those are is read off the plan rather
        // than named here: a station the theme is certain to occupy is a station
        // that exists to be recognised.)
        //
        // AND A COLLISION REDRAWS RATHER THAN GIVING UP. Refusing a realisation
        // used to mean the phrase became free invention, which is silence where
        // the theme should have been; now it means another way of saying it is
        // looked for, and only a station that cannot find one in a dozen tries
        // hands the phrase over.
        for (let tries = 0; tries < 12 && !step; tries++) {
          let form = pick(forms);
          if (last && arc.resolves) form = 'risolta';
          const stretch = between(plan.stretch[0], plan.stretch[1]) * (mood.stretch ?? 1);
          const lift = plan.lift * (mood.width ?? 1) + (mood.liftBias ?? 0);
          const print = `${form}/${transpose}/${Math.round(lift)}/${stretch.toFixed(1)}`;
          if (!frame && recent.includes(print)) continue;
          recent.push(print);
          if (recent.length > 8) recent.shift();
          step = {
            thematic: true,
            // The uniform octave is NOT folded into the shape here. Where a
            // phrase sits is a question about the register the instrument has
            // arrived in, and only the caller knows that; what a form carries
            // is the octave break that is part of the form itself.
            ...realise(form, { transpose, stretch }),
            lift: Math.round(lift),
            transpose,
            stretch,
            station: plan.name,
            tension: plan.tension,
            near: plan.near,
            print,
          };
        }
      }
      if (!step) {
        step = {
          thematic: false,
          station: plan.name,
          tension: plan.tension,
          near: plan.near,
          // A free phrase still sits in the arc's register and in the arc's
          // dynamic: the invention is free, the plan is not.
          lift: Math.round(plan.lift * (mood.width ?? 1) + (mood.liftBias ?? 0)),
        };
      }

      left--;
      // The breath after this phrase, as a multiplier: longer at the end of an
      // arc than anywhere inside one.
      step.breath = 1;
      if (left <= 0) {
        station++;
        if (station >= ARC.length) { step.breath = ARC_BREATH; newArc(width); }
      }
      return step;
    },
  };
}
