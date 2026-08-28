// The sound of being here.
//
// This world was mute. What it gets is not a soundtrack: it is the two things a
// body standing in a meadow would actually hear — its own feet and the air —
// plus a piano that plays in it, and never plays the same thing twice.
//
// THERE IS NO RECORDING OF MUSIC IN HERE ANY MORE, and there was: a piece that
// arrived, said what it had to say and went away, with a long silence either
// side so that nobody would hear it come round. It was replaced because a piece
// of music has a length, and a walker who stays hears the length. What is here
// now is an instrument and a hand: single sampled notes and a generator that
// decides, as it happens, what to do with them. See src/core/melody.js.
//
// THERE IS NO WATER IN HERE, and there was. The first cut had a rivulet running
// beside the path, with a distance curve, a polyline lifted from the terrain and
// two voices of grains. It is gone, all of it, because the thing it was the
// sound of turned out not to exist: the path is a stone path, lit in stretches
// and shaded in others, and the water in the ground was a misreading of the
// target that is being taken back out of the terrain as well. The lakes are far
// enough away that nothing of them arrives. A sound with nothing under it is not
// atmosphere, it is a lie about where the walker is standing — so the bus, the
// curve, the polyline and the delivered samples all left together.
//
// THE ONE PRINCIPLE THIS FILE IS BUILT ON: nothing here runs on a clock of its
// own. A footfall is played because the body reported one, not because a loop
// came round. Everything that could be periodic is built so that it cannot be —
// the air is two uncorrelated layers of noise opened and closed by rates with no
// common period, and the melody is an occurrence with a wide, unequal silence
// either side of it. There is nothing in here for an ear to learn the period of.
//
// AND IT COSTS NOTHING UNTIL IT IS ASKED FOR. No AudioContext before the first
// gesture — a browser refuses one and says so in the console — no bytes fetched
// before that either, and when the walker turns it off the context is
// suspended, which is the only form of "off" that stops paying for it.

import { CHARACTERS, DEFAULT_CHARACTER, createMelody } from './melody.js';

const FILES = {
  steps: 'audio/passi.m4a',
};

// The delivered sprite: sixteen footfalls in fixed slots, eight to a surface and
// FOUR to a foot, each cut so that its onset sits ON the slot boundary. One file
// rather than sixteen is one request and one header; where the encoder then put
// the whole thing is measured at load rather than assumed, see codecDelay.
//
// THE WALKER IS BAREFOOT, AND THAT IS A CHANGE OF SUBJECT, not another setting.
//
// Three passes chose stone, and three walks turned it down in the same word:
// straw, then heels, then still heels. The fourth answer does not come from
// ranking the same pool again — it comes from the committente changing what the
// thing IS:
//
//   «Immagina che il protagonista sia a piedi nudi, sia su pietra, che su erba,
//    che su altre superfici. Orchestra il suono come se camminassi a piedi
//    scalzi su varie superfici, in maniera morbida.»
//
// AND THE DEFECT WAS FINALLY MEASURABLE, in one number nobody had measured: how
// long the step takes to reach its peak. Three milliseconds is a shoe, because a
// shoe is a rigid shell meeting a rigid floor and the whole spectrum lands at
// once — an ear calls that a heel however dark you make it. A bare foot is flesh,
// and flesh COMPRESSES: the pad spreads the contact over tens of milliseconds,
// and while it is spreading it is a lossy damper that absorbs the top and lets
// the mass behind it through into the floor. An equaliser is a statement about
// the spectrum and cannot move that number, which is why it is the only one of
// the four that could ever have told these two sounds apart.
//
// THE STONE THAT CAME OUT OF THAT WAS A WOODEN FLOOR, AND THE WALK SAID SO:
//
//   «sembra che cammini su ASSI DI LEGNO SCRICCHIOLANTE»
//
// He was right and the source agrees with him: it was freesound 188680, «Barefoot
// Walking Hardwood floor». The rise had been bought by finding a recording that
// already had one, and everything else in that recording came with it. A board is
// a PLATE — a footfall excites modes below four hundred hertz that ring for
// hundreds of milliseconds — and a slab is mass on the ground, whose low end dies
// with the contact. Measured in that band, on the pool of vetted CC0 recordings:
//
//                          low-band ring   arrivals in one footfall
//   the hardwood floor         434 ms                8
//   every mineral recording  135-169 ms             0-2
//
// AND THE CREAK HAD BEEN PRINTED AND NOT READ. AUDIO3 built a counter of separate
// little hits inside one footfall and used it to name the first delivery straw at
// twelve to fifteen. The hardwood delivery printed ELEVEN in its own build log.
//
// SO THE TWO HALVES OF A BAREFOOT FOOTFALL NOW COME FROM DIFFERENT PLACES, and
// that split is the whole design of this package:
//
//   THE BODY IS RECORDED — freesound 465299, «Concrete Footsteps». A real mineral
//   slab under a real mass is the one thing no arithmetic here can invent, and it
//   is the pool AUDIO4's coda already shipped, so its timbre has been walked on.
//
//   THE RISE IS DRAWN, with the amplitude envelope, and it is declared as
//   synthesis. `soften(riseMs)` was written by AUDIO5 and used on nothing it
//   delivered; this is what it was for. The whole step is multiplied by a
//   smoothstep opening from six per cent over eighty milliseconds — which leaves
//   its floor with zero slope, so the step does not fade in, it CREEPS in and then
//   arrives.
//
// AND THEN THE FIFTH WALK, WHICH IS WHAT THIS PACKAGE ACTUALLY IS:
//
//   «Rendi il suono dei passi su pietra PIÙ MORBIDI, PIÙ OVATTATI.
//    SONO ANCORA TROPPO PESANTI.»
//
// TAKING THE KNOCK OUT IS NOT THE SAME AS TAKING THE BRIGHTNESS OUT, and nothing
// in the four passes before this one had ever measured the difference. The knock
// is the first twenty milliseconds; muffling is the absence of edge over the WHOLE
// footfall. The stone that collected this verdict scored −42,2 dB of knock — no
// crack at all — and carried a centroid of 796 Hz, which is nearly three times
// that of the delivery walked before it. Quiet on impact and bright for all the
// rest of its length.
//
// AND THE WEIGHT WAS NOT WHERE IT WAS LOOKED FOR. «Heavy» is usually too much
// under 150 Hz; in this pool 60-150 Hz was already 10,7 dB down, six decibels
// under the band that actually dominates. Read as shares of the whole, per band:
//
//                     40-80  80-150 150-300 300-600 0,6-1,2k 1,2-2,4k 2,4-5k 5-12k
//   walked before      −9,4   −4,0   −5,2   −12,0    −15,0   −20,0   −22,8  −26,9
//   turned down       −11,7  −10,7   −4,9    −4,8    −14,1   −14,6   −17,2  −15,6
//
// The mass of that delivery lived between 150 and 600 Hz. So both are cut: the
// deep shelf the brief names AND the hump the measurement points at. Everything
// is one complementary split run forwards and backwards, so `lo + hi` is the input
// to the last bit and every knob has a provable identity setting.
//
// Read off the delivered .m4a, at the slot boundaries the runtime itself finds:
//
//                     knock   bite   RISE   ring  arrivals  CENTROID  0,9-6 kHz  60-150
//   the hardwood      −43,6   183 Hz 148 ms 210 ms    4      275 Hz    0,039     0,473
//   turned down       −42,2   215 Hz  82 ms 128 ms    0      796 Hz    0,073     0,126
//   THIS STONE        −46,1   216 Hz  82 ms 129 ms    0      337 Hz    0,026     0,104
//   the approved grass −9,8   731 Hz  21 ms 285 ms    0     1806 Hz    0,232     0,079
//
// The muffling is bounded, and the bound is AUDIO3's: a footfall that wins every
// dullness column and has nothing left above a kilohertz is not dull, it is a
// thump without definition, and the pass before last nearly shipped one at 0,003.
// A lowpass at 1200 Hz run zero-phase — twelve decibels an octave — puts this pool
// at exactly that. It is at 2200 Hz, and the share between 0,9 and 3,5 kHz is
// 0,025: under the delivery it replaces, over the one before that.
//
// THE GRASS IS THE ONE THE COMMITTENTE APPROVED, PUT BACK. It is freesound
// 331167, Grass_Footsteps by Adielees9, rebuilt from the source through AUDIO3's
// chain with AUDIO3's constants — not lifted out of the old package, because
// lifting means a second generation of the codec on samples that were approved
// after one. Seven of its eight slots decode BIT-IDENTICAL to the blob at
// 56f0a54 (a residual 170 dB down, which is float noise); the eighth shares AAC
// frames with the stone half and lands 32 dB down. The same measurement against
// the grass that replaced it reads +3,5 dB, which is what «a different recording»
// looks like. See s2-audio6/erba-uguale.mjs — the proof, not this comment.
//
// Both sources are CC0, read on each sound's own page by the pass that found it
// and asserted again at the moment the samples enter the build.
//
// AND THERE ARE FOUR PER FOOT RATHER THAN THREE, because three with the last one
// ruled out is a choice between two, and a walk is hundreds of steps long.
const SPRITE = {
  slotSeconds: 0.55,
  count: 16,
  perFoot: 4,
  surfaces: { erba: 0, pietra: 8 },
};

export const TUNING = {
  // What the three voices are worth against each other. These are the numbers to
  // walk with: everything else in this file decides WHEN something sounds, and
  // these decide how much of it there is.
  mix: {
    // THE ORDER, WHICH IS THE DESIGN, after the walk that judged the first cut:
    //
    //   the feet     the reference, and by far the loudest thing in peak
    //   the melody   clearly audible, and never above the feet
    //   the air      a gentle presence, plainly there if you listen for it
    //
    // Two of those were wrong in the first cut, and it is worth writing down why
    // the arithmetic did not catch it. The bed of air sits at three hundred to a
    // thousand hertz, and an ear forty decibels below full scale is some fifteen
    // phon less sensitive there than at a kilohertz — so a bed that MEASURED
    // two decibels under everything else was heard as nothing at all. Flat RMS
    // ranked these voices; hearing did not agree with the ranking. Every number
    // here is therefore set from A-WEIGHTED bus levels as well as flat ones, and
    // both are in the record.
    //
    // AND IT CAME DOWN EIGHT DECIBELS, for two reasons that arrive together.
    //
    // The brief asks for it: «devi abbassare l'intensità», passi three to four
    // decibels under the delivery that was last walked. That is a target, and a
    // target is solved for once rather than crept up on — the pools are files and
    // this is a scalar, so the A-weighted level is exactly linear in it and the
    // answer is closed form (s2-audio5/pesa5.mjs). The reference was WEIGHED, not
    // remembered: AUDIO4 found its own bench holding the piano against a constant
    // that predated the pass which replaced every footfall, and it was five
    // decibels wrong.
    //
    // The extra half decibel is the samples themselves. Every pool in this package
    // is delivered at the loudest level none of its samples must be clipped to
    // reach, so what a pool is worth at that common peak depends on how transient
    // it is — and a bare foot is much less transient than a shoe. These samples
    // landed 0,72 dB ABOVE the old ones through the weighting before anything was
    // turned down at all.
    //
    //   delivered at unit gain, A-weighted:   +0,72 dB against the reference
    //   asked for:                            −3,5 dB
    //   so:  0,85 × 10^(−4,18/20) = 0,617  ->  measured −3,46 dB. In the window.
    //
    // A CONSEQUENCE WORTH WRITING DOWN: the worst case has come in under full
    // scale. A foot on stone is worth 1,27 at its very loudest by the arithmetic
    // in `step`, and 1,27 × 0,513 × 1,25 is 0,815 at the top rung, where the same
    // arithmetic once gave 1,349 — that is, the device used to be handed something
    // it could only hard clip, and now it is not. `TUNING.ceiling` is still
    // load-bearing on the top two rungs and still catches that 0,815; what has
    // gone is the case where it was the only thing between a loud step and a
    // broken one. See the note there.
    //
    // AND IT MOVED AGAIN — 0,62 → 0,513 — TO HOLD THE LEVEL STILL.
    //
    // The three verdicts that came back on the last delivery were about material:
    // the grass was wrong, the stone was a creaking board, the wind was too loud.
    // Not one of them was about how loud the feet are. So the cut that WAS asked
    // for stays exactly where it was put, and the number in front of it changes
    // because the pool behind it did: this stone reads 1,64 dB louder through the
    // weighting at the same peak than the hardwood pool it replaces, being less
    // transient and less dark.
    //
    //   hardwood pool × 1,0 × 0,62      −42,03 dB A-weighted   <- the target
    //   THIS pool     × 1,0 × 1,0       −36,24 dB
    //   so:  10^((−42,03 − −36,24)/20) = 0,513  ->  measured −42,03 dB, to nought
    //                                                decimal places of error
    //
    // HOLDING THE NUMBER WOULD NOT HAVE HELD THE LEVEL. That is the same trap the
    // last pass caught itself in one field down, and it is worth naming twice: a
    // constant only holds a mix still when nothing under it has moved.
    steps: 0.513,
    // Clearly audible, which is a change of brief: the first cut put the melody
    // deliberately under the air, and the walk could not find it at all. It is
    // now above the bed and under the feet — the level a room plays music at
    // while you are doing something else in it.
    //
    // AND IT CAME DOWN TWELVE AND A HALF DECIBELS, because it was never under the
    // feet at all. Two things had to be found before that could be said.
    //
    // THE BENCH'S REFERENCE WAS STALE. The piano's own bench held it three to
    // five decibels under «the feet at −37,7 dB» — a constant that predates the
    // pass which replaced every footfall in the package. The feet measure −46,9
    // dB now, so that bench was holding the melody some five decibels OVER the
    // real feet and reporting it as in target. A reference you did not measure is
    // a reference you are not entitled to.
    //
    // AND THE PIANO IS A DISTRIBUTION BETWEEN PAGE LOADS, not within one. Its
    // room is eight combs a channel at up to 0,972 and its phrases are drawn when
    // the world opens, so one load is nearly repeatable and the next is eleven
    // decibels away. Nine independent loads, walking on stone, both buses through
    // the same A-weighted probe in the same second, max of a one second window:
    //
    //   −1,4  +0,7  +1,0  +3,7  +6,2  +6,6  +7,9
    //   +9,3  +9,3  +11,1  +11,5  +12,9  +13,2  +15,6      dB vs the feet
    //
    // Median +8,6 dB, sigma 5,2, spread seventeen. This number is that median
    // moved to −4,0, the middle of the brief's window.
    //
    // (Fourteen loads and not nine: the scalar is exact and known, so the five
    // draws taken after a first correction normalise back onto this scale and
    // pool with the nine taken before it. Read on its own the smaller second
    // sample said −1,3 dB where the arithmetic said −4,0 — which is one standard
    // error of a five sample median of a seventeen decibel distribution, and is
    // a thing to pool, not a thing to chase. Turning the knob again on it would
    // have been tuning to the noise.)
    //
    // The spread does not divide out: on any given visit the piano will still be
    // several decibels either side of this, and the median is the only thing a
    // mix can be set on. The standard error of that median is about 1,7 dB, which
    // is most of the width of the target window — so «in target» here means the
    // centre is where it should be, not that every visit lands inside it.
    //
    // It is a scalar, used in exactly two places and nowhere else, and it is the
    // ONLY thing that changed — so the five states keep the balance they were
    // levelled to, 3,5 dB apart end to end.
    //
    // AND THEN THE STONE MOVED UNDER IT. The replacement footfalls are darker, and
    // A-weighting charges for that: at the same peak of 0,97 the new pool reads
    // 3,04 dB quieter through the curve than the one the median above was measured
    // against. The melody is a level RELATIVE to the feet, so it follows them down
    // by exactly that. Carrying the median across a change of reference that is
    // known to three decimals gave 0,0296 — and then six loads at that setting
    // read a median of −7,2 dB rather than −4,0, which is a decibel and a bit
    // more than one standard error of a six sample median and therefore worth
    // pooling rather than either chasing or ignoring.
    //
    // So all twenty independent loads are put on the same scale — the fourteen
    // earlier ones carried over by the gain applied to the music and the shift
    // measured in the feet, both known — and the median of the twenty is
    // −5,7 dB. This number is that, moved the last 1,7 dB to the middle of the
    // window. It is a distribution with a seventeen decibel spread and a standard
    // error near 1,5 dB on its median: «in target» means the CENTRE is placed, not
    // that any given visit lands inside.
    //
    // AND IT FOLLOWS THE FEET DOWN, BY EXACTLY THE SAME 3,53 dB. Everything above
    // stays true because none of it is about an absolute level: the brief for the
    // melody is a RATIO — three to five decibels under the feet — and a ratio is
    // preserved by moving both. 0,036 × 10^(−3,53/20) = 0,024.
    //
    // AND IT DOES NOT MOVE, THOUGH THE FEET HAVE NOW MOVED UNDER IT — which is a
    // change of answer from the pass before, so here is the whole of it.
    //
    // The stone came down 2,0 dB this pass and this did not follow. By the doctrine
    // in the paragraph above that is wrong: the melody's brief is a RATIO to the
    // feet, so this ought to read 0,0191. Two things say otherwise, and both are
    // checkable rather than argued.
    //
    // The brief for this pass is «cura sulla SOLA pietra». Turning a second knob
    // inside a targeted repair is how a repair stops being legible.
    //
    // And the ratio does not leave its window. Measured on the delivery this
    // refines, the melody sat at −5,1 dB under the feet — the QUIET edge of the
    // −3/−5 the brief asks for — so the feet dropping 2,0 dB carries it to about
    // −3,1, the loud edge of the same window and still inside it. The piano is
    // another unit's, drawn fresh at every page load, with a seventeen decibel
    // spread between visits and roughly 1,5 dB of standard error on its median.
    //
    // IT IS THE CLOSEST CALL IN THIS FILE, because the arithmetic centre AUDIO4
    // set (−4,0 dB) would land at −2,0 and be outside. If a walk says the piano now
    // stands over the feet, 0,024 → 0,0191 is the whole of the repair, and it is a
    // lever in s2-audio6/COME-PROVARE.md.
    //
    // (Left where AUDIO4 had it, through that earlier 3,53 dB move, it would have
    // sat ABOVE the feet, which is the single
    // loudest defect this unit has ever shipped: AUDIO4 measured the piano at
    // +16 dB over the steps and said, correctly, that a walker in that state
    // judges the footsteps THROUGH the piano. The feet have just become the
    // quietest thing in the world; a music bus that did not follow them would
    // bury the very samples that pass existed to let you hear.)
    music: 0.024,
    // The air is the room the other two sounds are in, and it has to be a room
    // you can hear the walls of. THIS NUMBER MEANS SOMETHING ELSE than it did in
    // the first two cuts: it is the level of a FULL GUST, not the level of a bed
    // that is always there. Most of the time the air sits a good twenty decibels
    // under it, so the same «gentle presence» costs a larger number.
    //
    // AND IT IS BACK WHERE IT WAS, BECAUSE THE WALK SAID SO: «TORNA COME PRIMA».
    //
    // The pass before this one held this number still while the feet came down
    // 3,46 dB, and argued for it: the wind's brief is the only one written as an
    // ABSOLUTE — «morbido, gentile, a folate», a room rather than a relation — so
    // moving it with the others would have been three voices going down together,
    // which is the volume knob the walker already has on the menu.
    //
    // The argument was not silly and it was wrong, and it is left here because the
    // way it was wrong is worth keeping. It also wrote down, honestly, exactly what
    // it cost and exactly which number undid it:
    //
    //                                      before        after       now
    //   air at a gust's crest, vs feet     −3,9 dB      +1,4 dB     −3,9 dB
    //   air at its median, vs feet        −13,8 dB      −8,3 dB    −13,8 dB
    //
    // At the crest the air had gone from four decibels under the loudest second of
    // the feet to slightly over it. A crest is five per cent of the time, and five
    // per cent of the time is enough: what a walker heard was weather standing on
    // top of their own feet.
    //
    // THE AIR ITSELF HAS NOT CHANGED — not a line of the gust model has been
    // touched in two passes — so this is arithmetic and not a rebuild. The feet sit
    // where the last delivery put them, so the wind has to come down by the same
    // 3,46 dB the feet did, and 0,22 × 10^(−3,46/20) = 0,148 restores the ratio the
    // walk approved to the third decimal. It was the first lever the last pass
    // handed over, and it is the one that got pulled.
    wind: 0.148,
  },

  step: {
    // A landing is reported on the frame the body noticed it, which is up to a
    // frame after it happened. Scheduling a fixed lead ahead and subtracting
    // how far into the step the frame already is turns a jitter of one frame
    // into a constant offset of this many milliseconds — and a constant offset
    // of twenty milliseconds is a sound that arrives with the foot, where a
    // jitter of sixteen is a walk that limps.
    leadMs: 20,
    // How much of the level comes from how hard the foot landed and how much
    // from how long the body has been working: the brief asks for both.
    impact: 0.45,
    effort: 0.30,
    // Nothing may read as a metronome, so no foot plays the sample it played
    // last, and nothing plays at the pitch or the level of the step before.
    pitchJitter: 0.07,
    gainJitter: 0.08,
    // Which foot it was, as a hair of stereo. A step is under the walker, so
    // this is a suggestion and not a position.
    footPan: 0.10,
    // A foot on worked stone is louder than a foot in grass, and the difference
    // is information about where the walker is standing. The two pools are
    // levelled separately in the delivery, so this is the one number that says
    // how far apart they sit.
    //
    // GRASS IS THE APPROVED RECORDING AGAIN, AND THIS NUMBER IS THE RATIO IT WAS
    // APPROVED AT — the one AUDIO3 measured, walked, and was never complained
    // about: SIX DECIBELS UNDER THE STONE, A-weighted.
    //
    //                                    A-weighted     on the peak
    //   AUDIO3, walked and approved         −5,76 dB      −9,84 dB
    //   AUDIO4's coda, at 0,32              −2,72 dB      −9,83 dB
    //   AUDIO5, at 0,181                    −2,71 dB     −15,33 dB
    //   THIS, at 0,25                       −5,79 dB     −11,90 dB
    //
    // The contrast had halved without anybody choosing to halve it. AUDIO4's coda
    // made the stone darker, A-weighting charges three decibels for that, and the
    // ratio narrowed from six to under three — its own verbale says so and says it
    // left the repair to the committente. AUDIO5 then matched the narrowed figure,
    // so the narrowing carried into a third delivery. Stepping off the path is
    // supposed to be an EVENT: this puts it back to the size it was when it was
    // approved.
    //
    // SO «I DID NOT TOUCH THE BALANCE» WOULD HAVE BEEN A LIE TOLD BY A CONSTANT.
    // Holding a gain still is only holding the mix still when nothing under it has
    // moved. Here the whole stone pool moved, and keeping the number would have
    // been the change.
    //
    // THIS NUMBER HAS NOW BEEN RE-DERIVED FIVE TIMES, and every time from the
    // A-WEIGHTED reading rather than from the RMS of the files. That choice is
    // the one piece of method here worth keeping: grass carries far more of its
    // energy above three kilohertz than stone does — a rustle against a thump —
    // and that is where an ear is most sensitive, so a flat RMS ranks these two
    // wrongly and a walk has twice disagreed with it. The values it has held are
    // 0,88 → 0,46 → 0,32 → 0,181 → 0,25, and each move was the same arithmetic
    // answering a different pair of pools.
    //
    // (WHAT IT COSTS, said plainly: in ABSOLUTE terms the grass now sits 6,5 dB
    // under where it sat in the delivery it was approved in. Three and a half of
    // those are the whole world coming down when «devi abbassare l'intensità» was
    // asked for, and three are the contrast being put back. The SAMPLES are the
    // approved ones to the last bit and the RATIO is the approved one; the absolute
    // follows the feet, because the feet are what everything in this file is
    // measured from. If a walk says the meadow has gone too quiet, this is the
    // number and 0,35 puts its absolute back where it was.)
    //
    // AND `stoneGain` HAS STOPPED BEING THE PEG. Four passes said it stays at 1,0
    // «because it is the peg everything else is measured from», and that was a good
    // rule while every complaint was about the stone's CHARACTER. The fifth walk is
    // about its WEIGHT — «SONO ANCORA TROPPO PESANTI» — and the grass and the air
    // are both accepted and must not move.
    //
    // Those two facts pick the knob on their own. `mix.steps` carries all three
    // voices of the ground, so it cannot be touched without moving the grass;
    // `grassGain` carries the grass alone. The only scalar that reaches the stone
    // and nothing else is this one. So it moves, and the two numbers that carry the
    // grass are frozen exactly where the last delivery had them — measured, not
    // asserted: the grass reads −47,82 dB before and −47,82 dB after, a difference
    // of nought to three decimals.
    //
    //   stone in the delivery walked   −42,03 dB A-weighted
    //   asked for                      −2 dB, the middle of the brief's window
    //   this pool × mix.steps × 1,0    −42,16 dB
    //   so:  10^((−44,03 − −42,16)/20) = 0,806  ->  measured −44,03 dB, nought error
    //
    // TWO CONSEQUENCES, AND NEITHER IS HIDDEN INSIDE AN AVERAGE. Stepping off the
    // path is now a SMALLER event: the grass sits 3,79 dB under the stone where it
    // sat 5,79, because the stone came down and the grass did not. And the air is
    // relatively louder — at a gust's crest it now sits 1,9 dB under the loudest
    // second of the feet where it sat 3,9, which is half of the repair the walk
    // before this one asked for. `mix.wind` 0,148 → 0,118 would give that back
    // exactly; it is not done here because the air was accepted and «non si tocca»,
    // and undoing an accepted number on my own authority is what the pass before
    // last was told off for.
    stoneGain: 0.806,
    grassGain: 0.25,
  },

  // THE AIR, AS WEATHER AND NOT AS A SETTING.
  //
  // The first two cuts of this file made the wind out of two layers of noise
  // held open by slow oscillators. It measured correctly and it was wrong: an
  // oscillator that never closes is a bed, and a bed at a constant level is a
  // hiss. The walk found exactly that — «fisso, troppo preponderante».
  //
  // What is here now is not a bed with variation on it. It is a sequence of
  // EVENTS, on the same principle every other voice in this file is built on: a
  // gust is scheduled because the weather decided one, not because a wave came
  // round. Between gusts there is very nearly nothing — and «very nearly
  // nothing» is what makes the next gust arrive instead of merely getting
  // louder.
  //
  // AND THE TIMBRE TRAVELS WITH THE INTENSITY, which is the whole difference
  // between a gust and a volume knob. Moving air is turbulent, and turbulence
  // puts energy up the spectrum as it grows: a gust that is mounting gets
  // brighter and hissier before it gets louder, and the hiss dies before the
  // body does. So the filters are swept by the same envelope that opens the
  // gains, and the grass layer is given a POWER of that envelope rather than the
  // envelope itself — it arrives late and it leaves early.
  wind: {
    // THE FLOOR: the air that never quite stops. Everything below is a share of
    // one full gust, so this is «a gust is ten times the quiet».
    floor: 0.16,
    floorHz: 380,
    floorQ: 0.6,
    floorDepth: 0.45,     // how far the slow signals open and close the floor
    floorSweepHz: 90,

    // HOW MANY GUSTS CAN BE SOUNDING AT ONCE. Two overlap often — a long fall
    // under a new rise, which is what a windy minute is made of — and three is
    // there so that the rare triple is not silently dropped.
    voices: 3,

    // THE SHAPE OF ONE GUST, in seconds. It mounts faster than it dies, always:
    // that asymmetry IS the gust. A symmetric swell reads as a fade.
    riseS: [2.0, 5.0],
    fallS: [5.0, 12.0],
    // How sharply the fall lets go. The tail is exponential, and this is the
    // exponent over the whole of it: small is a long even sigh, large is a drop
    // and then a long thin tail.
    fallCurve: 3.2,

    // WHAT THE WEATHER DECIDES. The three incommensurate rates this file has
    // always used no longer open a gain — they decide whether this minute is a
    // gusty one or a still one, which is a thing that has no period either but
    // is felt over a minute rather than over a second.
    //
    // The gap is counted from the CREST of one gust to the start of the next, so
    // a long fall and a short gap overlap by construction.
    gapStillS: [8, 18],
    gapWindyS: [3, 7],
    peakStill: [0.18, 0.48],
    peakWindy: [0.55, 1.0],

    // THE BODY OF THE AIR: a lowpass that opens as the gust mounts.
    bodyHz: [240, 560],
    bodyQ: 0.6,
    bodyShare: 0.44,
    // AND WHAT IT DOES IN THE GRASS — we are standing in a meadow, and most of
    // what a walker calls «wind» is the sound of the grass being got at. A
    // bandpass whose centre climbs with the gust, given the larger share because
    // it is the half of the bed an ear at this level can actually hear.
    grassHz: [950, 2500],
    grassQ: 0.7,
    grassShare: 0.56,
    // The exponent that makes the hiss arrive after the body and leave before
    // it. One would be «the same as the body»; this is «only when it means it».
    grassBias: 1.7,
    // And the unsteadiness inside the rustle: grass does not swell smoothly, it
    // is worried at. Three rates a couple of octaves apart, shallow, and gated
    // by the gust — between gusts there is nothing for it to flutter.
    flutterHz: [0.87, 1.906, 4.174],
    flutterDepth: 0.18,

    // How far ahead gusts are placed on the audio clock. Everything is scheduled
    // ahead, so a slow frame — or a frame that never comes — moves nothing that
    // has already been placed.
    lookaheadS: 4,
    // Resolution of the curve written into each AudioParam: a gust is seconds
    // long and this is tens of milliseconds a point, which is far finer than
    // anything about a gust that an ear can follow.
    curvePoints: 256,
    noiseSeconds: 16,
  },

  music: {
    // WHEN THE FIRST PHRASE LANDS, counted from the gesture that opened the
    // world and not from whenever the package happened to finish arriving. A
    // walker who leaves after half a minute should already know that this world
    // has music in it: it is a room with a piano, and you should be able to tell
    // that from the doorway.
    //
    // Everything else about the melody — how rare, how low, how long the room
    // rings — belongs to the character it is playing, in src/core/melody.js.
    firstDelayS: 2.5,
  },

  // A SOFT CEILING, AND NOTHING ELSE. Not a compressor and not a sound: a
  // memoryless curve that is EXACTLY the identity below this threshold and bends
  // over above it. Zero latency, which a DynamicsCompressor is not.
  //
  // On «Basso» nothing in the world reaches the threshold, so the curve is
  // provably not in the signal at all — below it the curve is the straight line
  // `u`, which a linear interpolation between samples reproduces without error,
  // so this path is a wire and not a colour. On the top two rungs a footfall on
  // stone does pass it, and a soft knee is the difference between a loud step and
  // an ugly one.
  //
  // WHAT KEEPS CHANGING IS THE WORST CASE, not this number. A foot on stone is
  // worth 1.27 at its very loudest by the arithmetic in `step`; times a `mix.steps`
  // of 0.85 and the top rung's 1.25 that was 1.349, which is to say the device was
  // being handed something it could only hard clip and this curve was the only
  // thing standing in the way. At 0.62 it was 0.984 and at 0.513 it was 0.815; with
  // `stoneGain` down to 0.806 as well it is 1.27 × 0.513 × 0.806 × 1.25 = 0.656 —
  // barely over the threshold, so the knee is now doing almost nothing even at the
  // top rung, and a third of full scale is spare.
  ceiling: 0.60,
};

// The same incommensurate octaves the body's postural sway is built from: rates
// about 2.19 apart rather than exactly 2, so no two of them share a period. Four
// multipliers, one per modulated signal, so no two signals share a rate set
// either — without them the two layers would open and close together, which is
// one layer with extra steps.
const OCTAVES = [0.0170, 0.0372, 0.0815];
const OCTAVE_NORM = 1 / OCTAVES.reduce((sum, _, i) => sum + 1 / (i + 1), 0);
const SIGNAL_RATE = [1, 0.8713, 1.1287, 0.9411, 1.0637];

/** A number in [lo, hi), drawn fresh. */
function between(lo, hi) { return lo + Math.random() * (hi - lo); }

/**
 * THE WEATHER: nought is a still minute, one is a gusty one.
 *
 * The same three incommensurate rates the body's postural sway is built from,
 * summed with weights falling as one over f. They no longer open a gain — that
 * was the mistake this cut is undoing — they decide how often gusts come and how
 * hard they blow, which is a thing felt over a minute.
 *
 * For the sum to return to where it started would need a time that is a whole
 * multiple of all three periods, and there is none inside a century. The phases
 * are drawn once per visit, so two visits are not the same weather either.
 */
function windiness(t, phase) {
  let sum = 0;
  for (let i = 0; i < OCTAVES.length; i++) {
    sum += (1 / (i + 1))
      * Math.cos(2 * Math.PI * OCTAVES[i] * SIGNAL_RATE[4] * t + phase[i]);
  }
  return clamp(0.5 + 0.5 * sum * OCTAVE_NORM, 0, 1);
}

/**
 * ONE GUST, as a shape between nought and one.
 *
 * `u` runs from 0 at the first breath to 1 at the last. It mounts on a
 * smoothstep — which leaves at nought with zero slope, so a gust CREEPS in
 * rather than switching on — and dies on an exponential that reaches exactly
 * nought at the end, so nothing is ever cut off.
 *
 * The crest is a corner, and it is a corner on purpose: a gust peaks and starts
 * losing, it does not sit at the top. Over seconds, a corner in an envelope is
 * not something an ear hears as a corner.
 */
function gustShape(u, riseFrac, k) {
  if (u <= 0 || u >= 1) return 0;
  if (u < riseFrac) {
    const r = u / riseFrac;
    return r * r * (3 - 2 * r);
  }
  const f = (u - riseFrac) / (1 - riseFrac);
  const e = Math.exp(-k);
  return (Math.exp(-k * f) - e) / (1 - e);
}

// THE LADDER. Four rungs about three and a half decibels apart — −5.2, −1.4 and
// +1.9 dB against unity — which is close enough to the smallest step in loudness
// that reads as a step at all, and far enough that nobody presses twice.
//
// The whole of the balance lives at «Basso», and it lives there because that is
// the default and because the world's two voices share one gain: their ratios
// do not change from one rung to the next, only how much of all of it there is.
// So «Basso» is where the mix was measured and the other three are the same mix,
// louder. What the top rung used to need was not a different balance but
// headroom, and that is TUNING.ceiling one floor down — though since the feet
// came down there is no longer a rung at which anything gets close to it. See
// the note there.
const LEVELS = {
  muto: 0, basso: 0.55, medio: 0.85, alto: 1.25,
};
const STORAGE = { world: 'farfield.audio.mondo', music: 'farfield.audio.musica' };

function clamp(value, low, high) {
  return value < low ? low : (value > high ? high : value);
}

function storedChoice(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw in LEVELS ? raw : fallback;
  } catch {
    return fallback;
  }
}

function storeChoice(key, choice) {
  try {
    window.localStorage.setItem(key, choice);
  } catch {
    // A browser that refuses storage still gets the setting, for this visit.
  }
}

/** Whether this machine can decode what the package is delivered in. */
function canDecodePackage() {
  try {
    return document.createElement('audio')
      .canPlayType('audio/mp4; codecs="mp4a.40.2"') !== '';
  } catch {
    return false;
  }
}

/**
 * Pink noise, as the bed both layers of air are read from.
 *
 * White filtered to roughly one over f, which is the slope moving air actually
 * has: white reads as a hiss and brown as a rumble, and neither reads as
 * weather. Paul Kellet's three pole approximation, exact enough over the band a
 * lowpassed and a bandpassed copy of it survive into, for a buffer built once.
 *
 * AND THE SEAM IS CLOSED. This buffer is the one thing in the file that does
 * have a period. The period is not audible as a tune, but the discontinuity at
 * the wrap is audible as a tick, and a tick every sixteen seconds is exactly
 * what an ear locks onto. So the tail is crossfaded into the head with an equal
 * power pair — the two are uncorrelated, and a linear blend of uncorrelated
 * noise loses three decibels in the middle — and the buffer is then SHORTENED by
 * the crossfade, which is what actually makes the last sample and the first one
 * neighbours in the original.
 */
function pinkNoise(context, seconds) {
  const rate = context.sampleRate;
  const raw = Math.round(rate * seconds);
  const fade = Math.round(rate * 0.25);
  const length = raw - fade;
  const source = new Float32Array(raw);
  let b0 = 0; let b1 = 0; let b2 = 0;
  let sum = 0;
  for (let i = 0; i < raw; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.0990460;
    b1 = 0.96300 * b1 + white * 0.2965164;
    b2 = 0.57000 * b2 + white * 1.0526913;
    const v = b0 + b1 + b2 + white * 0.1848;
    source[i] = v;
    sum += v * v;
  }
  // Levelled to a known RMS, so the mix numbers above mean the same thing
  // whatever the filter left behind.
  const g = 0.25 / Math.sqrt(sum / raw);
  const buffer = context.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = source[i] * g;
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    data[i] = (source[i] * Math.sin(t * Math.PI / 2)
      + source[length + i] * Math.cos(t * Math.PI / 2)) * g;
  }
  return buffer;
}

/**
 * Where the encoder put the sprite.
 *
 * Every slot was cut so its onset sits exactly on the slot boundary, and the
 * encoder then moved the whole file by a constant it does not have to declare.
 * So it is measured: find the first sample over a threshold in a window after
 * each nominal boundary and take the MEDIAN of the twelve answers, because a
 * median survives the one slot whose quiet opening fools a threshold and a mean
 * does not.
 *
 * THIS PROBE ASSUMES EVERY SLOT ANSWERS THE SAME QUESTION, and once the two
 * surfaces stopped having the same kind of onset it stopped being true. Six per
 * cent of a slot's peak is crossed at once by a heel strike and only well into
 * the ramp by a footfall that mounts over eighty milliseconds: on the first build
 * of this delivery the grass slots answered 4,0 ms and the stone slots 6,3 to 8,0,
 * and the median came out at 6,26 — the midpoint of two groups that do not belong
 * in one median. At that offset the runtime would have started every grass sample
 * two and a quarter milliseconds past its own onset.
 *
 * IT IS FIXED IN THE PACKAGE AND NOT HERE, deliberately. The grass has to be read
 * at the offset the approved delivery was read at, and it already is; so the stone
 * cuts are shifted at build time until they answer where the grass answers, which
 * costs them two to four milliseconds off the bottom of a ramp that is
 * twenty-four decibels down there. All sixteen slots now probe 4,0 ms and the
 * residual error at the boundary is at worst 0,84 ms late — against 3,8 ms in the
 * delivery before last. See s2-audio6/confine.mjs and build6.mjs alignProbe().
 */
function codecDelay(buffer) {
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  const slot = Math.round(SPRITE.slotSeconds * rate);
  const window = Math.round(rate * 0.060);
  const found = [];
  for (let k = 0; k < SPRITE.count; k++) {
    const at = k * slot;
    const end = Math.min(data.length, at + slot);
    let top = 0;
    for (let i = at; i < end; i++) top = Math.max(top, Math.abs(data[i]));
    if (top <= 0) continue;
    const threshold = top * 0.06;
    for (let i = at; i < Math.min(data.length, at + window); i++) {
      if (Math.abs(data[i]) > threshold) { found.push(i - at); break; }
    }
  }
  if (!found.length) return 0;
  found.sort((a, b) => a - b);
  return found[found.length >> 1] / rate;
}

/**
 * The soft ceiling's curve: exactly the identity below the threshold, and a
 * tanh knee above it.
 *
 * Built over an input range of ±2 rather than ±1 — a WaveShaper reads its curve
 * across [−1, 1] and CLAMPS anything outside, so a curve built over the nominal
 * range would hard clip exactly the peaks it exists to catch. Hence the halving
 * on the way in and the doubling on the way out, and hence a curve whose middle
 * is the straight line `u`, which a linear interpolation between samples
 * reproduces without error: below the threshold this node is not a colour, it is
 * a wire.
 */
function ceilingCurve(threshold, points = 4097) {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const u = (i / (points - 1)) * 2 - 1;
    const a = Math.abs(u) * 2;
    const shaped = a <= threshold
      ? a
      : threshold + (1 - threshold) * Math.tanh((a - threshold) / (1 - threshold));
    curve[i] = Math.sign(u) * shaped * 0.5;
  }
  return curve;
}

/**
 * THE WAKING, AND IT IS THE ONLY THING IN HERE THE OPENING SCENE MAY ASK FOR.
 *
 * Hearing comes back before sight. A body that has just opened its eyes hears
 * the world through the wall first and then in the room, and the cheapest
 * honest model of "through the wall" is a single pole low pass with its corner
 * down where speech and wind still have a body but no edges: everything above
 * five hundred and sixty hertz is what makes a sound sound NEAR, and taking it
 * away is what makes the same mix sound like it is happening somewhere else.
 *
 * Q AT FOUR TENTHS, which is under the 0.7071 that would make the response
 * maximally flat. A biquad at resonance puts a bump exactly on the corner, and
 * a corner that is SWEEPING is then a whistle climbing through the mix — the
 * one artefact that would turn this from a thing being uncovered into an
 * effect. Damped, the sweep has no note of its own.
 *
 * SIXTEEN KILOHERTZ AND NOT INFINITY, and it is left there rather than bypassed:
 * an open biquad costs a multiply-add per sample and is arithmetically almost
 * the wire it replaced, while unplugging a node from a running graph is a
 * discontinuity in the signal — which is a click, at the exact moment the scene
 * has finished promising there would not be one.
 *
 * AND THE MASTER RISES SLOWER. The ordinary fade in is 0.5 s of time constant,
 * which is right for a click that opens a world already in front of the walker.
 * Under the scene there are three and a half seconds of blinking to cover, and
 * a mix that was fully up in the first half second would have the hearing arrive
 * before the sight rather than ahead of it.
 */
const WAKE = {
  startHz: 560,
  endHz: 16000,
  q: 0.4,
  masterTau: 0.9,
};

/**
 * The sound of being here.
 *
 * @param {object} options
 * @param {string} options.base  where the package is served from
 * @param {boolean} options.auto whether the first gesture starts it. False in
 *   development: the poses this campaign is judged on are frames, and a frame
 *   time measured with an audio thread running is not the number the gates hold.
 */
export function createAudio({ base = './', auto = true } = {}) {
  let context = null;
  let started = false;
  // Asked once, before any gesture: it builds a detached element and reads a
  // string, which is free and cannot trip the autoplay policy. The menu needs
  // the answer to draw its two rows, and it draws them before the first click.
  const supported = Boolean(window.AudioContext || window.webkitAudioContext)
    && canDecodePackage();
  let failed = !supported;

  let worldChoice = storedChoice(STORAGE.world, 'basso');
  let musicChoice = storedChoice(STORAGE.music, 'basso');

  // Everything the graph is made of, built once and never rebuilt.
  const nodes = {};
  // Whether the muffle is armed. Read by buildGraph and by nobody else, and it
  // is set BEFORE the context exists on purpose: the filter goes in while the
  // graph is being made, so there is never a live graph to rewire and never a
  // node to unplug. Left false — which is every visit that is not the opening
  // scene — buildGraph takes the branch it has always taken.
  let waking = false;
  let wakeSeconds = 3.55;
  let sprite = null;
  let spriteDelay = 0;
  let melody = null;
  // When the gesture happened, on the audio clock. The melody is scheduled from
  // HERE and not from whenever the bytes landed.
  let openedAt = 0;

  // What the last frame decided, kept so nothing has to be allocated to answer
  // a question twice.
  let lastFootfall = -1;
  const lastPick = [-1, -1, -1, -1];
  let costUs = 0;

  // The weather: the voices a gust can be placed on, the gusts that have been
  // placed, when the next one is due, and the phases this visit's weather runs
  // on. `gustLevel` is the public reading, and it is nought until there is a
  // running context to read it from.
  const voices = [];
  const gusts = [];
  let nextGustAt = 0;
  let windPhase = [0, 0, 0];
  let gustLevel = 0;

  function worldLevel() { return LEVELS[worldChoice] ?? 0; }
  function musicLevel() { return LEVELS[musicChoice] ?? 0; }
  function anythingWanted() { return worldLevel() > 0 || musicLevel() > 0; }

  function applyChoices() {
    if (!context) return;
    const now = context.currentTime;
    nodes.world.gain.setTargetAtTime(worldLevel(), now, 0.08);
    nodes.music.gain.setTargetAtTime(musicLevel() * TUNING.mix.music, now, 0.20);
    // Sent away, the piano is DISCONNECTED and not merely closed behind a gain.
    // Its room is a network of delays that would otherwise go on being computed
    // for nobody — and the walker who turned the music off asked for it to stop
    // costing them something. Asked back, it answers on the same promise it
    // makes at the door: within firstDelayS, never under the finger.
    if (melody) melody.setActive(musicLevel() > 0, now + TUNING.music.firstDelayS);
    // And off is a suspended context, not a gain of zero, for the same reason
    // one floor up: the walker who turned it off asked for it to stop costing
    // them something.
    if (anythingWanted()) {
      if (context.state === 'suspended') context.resume().catch(() => {});
    } else if (context.state === 'running') {
      setTimeout(() => {
        if (!anythingWanted() && context.state === 'running') context.suspend().catch(() => {});
      }, 400);
    }
  }

  /** One slow, unrepeating signal, wired straight into an AudioParam. */
  function modulate(param, base, depth, signal) {
    param.value = base;
    for (let i = 0; i < OCTAVES.length; i++) {
      const osc = context.createOscillator();
      osc.frequency.value = OCTAVES[i] * SIGNAL_RATE[signal];
      const gain = context.createGain();
      // Weights falling as one over f, which is what a slow natural variation
      // measures like, normalised so the sum of them is the depth asked for.
      gain.gain.value = depth * OCTAVE_NORM / (i + 1);
      osc.connect(gain).connect(param);
      osc.start();
    }
  }

  function buildWind() {
    const w = TUNING.wind;
    const noise = pinkNoise(context, w.noiseSeconds);
    nodes.wind = context.createGain();
    nodes.wind.gain.value = TUNING.mix.wind;
    nodes.wind.connect(nodes.world);

    // THE FLOOR. One dark layer at a fraction of a gust, opened and closed by the
    // slow signals the way the whole bed used to be. It is what stops the world
    // going to digital silence between gusts — an outdoor place with nothing in
    // it at all reads as a fault, not as calm — and it is quiet enough that the
    // next gust is an arrival.
    const floor = context.createBufferSource();
    floor.buffer = noise;
    floor.loop = true;
    floor.playbackRate.value = 0.82;
    const floorFilter = context.createBiquadFilter();
    floorFilter.type = 'lowpass';
    floorFilter.Q.value = w.floorQ;
    nodes.windFloor = context.createGain();
    floor.connect(floorFilter).connect(nodes.windFloor).connect(nodes.wind);
    modulate(nodes.windFloor.gain, w.floor, w.floor * w.floorDepth, 0);
    modulate(floorFilter.frequency, w.floorHz, w.floorSweepHz, 1);
    floor.start(0, 0);

    // THE FLUTTER inside the grass, built once and wired into every voice: an
    // AudioNode's output may drive any number of AudioParams, so three
    // oscillators serve all the gusts there will ever be.
    //
    // This node SUMS them, so its own gain is unity — the oscillators are its
    // inputs, and a gain of nought here multiplies all three by nothing and
    // delivers silence. Said out loud because the first cut of this had it at
    // nought, and a flutter that is not there is not a thing anybody notices.
    const flutter = context.createGain();
    flutter.gain.value = 1;
    for (const hz of w.flutterHz) {
      const osc = context.createOscillator();
      osc.frequency.value = hz;
      const depth = context.createGain();
      depth.gain.value = w.flutterDepth / w.flutterHz.length;
      osc.connect(depth).connect(flutter);
      osc.start(Math.random() * 2);
    }

    // THE VOICES. Each is a whole small wind of its own — its own noise, its own
    // body and its own grass — so two gusts that overlap are two different winds
    // and not one wind twice as loud.
    for (let i = 0; i < w.voices; i++) {
      const source = context.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      source.playbackRate.value = 0.86 + i * 0.17;

      const body = context.createBiquadFilter();
      body.type = 'lowpass';
      body.Q.value = w.bodyQ;
      body.frequency.value = w.bodyHz[0];
      const bodyGain = context.createGain();
      bodyGain.gain.value = 0;

      const grass = context.createBiquadFilter();
      grass.type = 'bandpass';
      grass.Q.value = w.grassQ;
      grass.frequency.value = w.grassHz[0];
      // Two gains in series, and the order is the point: the flutter multiplies
      // the gust rather than adding to it, so between gusts there is nothing for
      // it to be a flutter of. A single node with both an automation curve and a
      // connected oscillator would SUM them, and the wind would tremble in the
      // silences.
      const grassFlutter = context.createGain();
      grassFlutter.gain.value = 1;
      flutter.connect(grassFlutter.gain);
      const grassGain = context.createGain();
      grassGain.gain.value = 0;

      source.connect(body).connect(bodyGain).connect(nodes.wind);
      source.connect(grass).connect(grassFlutter).connect(grassGain).connect(nodes.wind);
      source.start(0, (i * 5.7) % w.noiseSeconds);

      voices.push({
        source, body, bodyGain, grass, grassGain, freeAt: 0,
      });
    }
    // Drawn once a visit, so no two visits get the same weather.
    windPhase = OCTAVES.map(() => Math.random() * Math.PI * 2);
    nextGustAt = context.currentTime + between(1.5, 4.0);
  }

  /**
   * Places one gust on one voice, as four curves written on the audio clock.
   *
   * `setValueCurveAtTime` is used rather than a chain of ramps because the shape
   * IS the gust: a rise that leaves nought with zero slope and a fall that is
   * exponential are not two line segments, and a triangle reads as a fade in and
   * a fade out rather than as weather. The cost is that curves on one param may
   * not overlap — which is why a voice is only handed a gust once the last one
   * it was given has finished.
   */
  function scheduleGust(voice, at, rise, fall, level) {
    const w = TUNING.wind;
    const span = rise + fall;
    const riseFrac = rise / span;
    const n = w.curvePoints;
    const bodyCurve = new Float32Array(n);
    const grassCurve = new Float32Array(n);
    const bodyHz = new Float32Array(n);
    const grassHz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const e = gustShape(i / (n - 1), riseFrac, w.fallCurve) * level;
      // The grass gets a POWER of the envelope: it arrives after the body and it
      // is gone before it, which is what a gust getting at a meadow sounds like.
      const g = e ** w.grassBias;
      bodyCurve[i] = e * w.bodyShare;
      grassCurve[i] = g * w.grassShare;
      bodyHz[i] = w.bodyHz[0] + (w.bodyHz[1] - w.bodyHz[0]) * e;
      grassHz[i] = w.grassHz[0] + (w.grassHz[1] - w.grassHz[0]) * e;
    }
    voice.bodyGain.gain.setValueCurveAtTime(bodyCurve, at, span);
    voice.grassGain.gain.setValueCurveAtTime(grassCurve, at, span);
    voice.body.frequency.setValueCurveAtTime(bodyHz, at, span);
    voice.grass.frequency.setValueCurveAtTime(grassHz, at, span);
    // The noise this gust is made of is re-drawn while the voice is silent, so
    // no two gusts on one voice read the buffer at the same speed — and the one
    // thing in here that has a period is that much further out of reach.
    voice.source.playbackRate.setValueAtTime(between(0.78, 1.28), at);
    voice.freeAt = at + span;
    gusts.push({ at, span, riseFrac, level });
    if (gusts.length > 16) gusts.splice(0, gusts.length - 16);
  }

  /**
   * The weather, pumped from the frame but living on the audio clock.
   *
   * This runs even when the world's voices are turned all the way down: the gust
   * state is a public reading that the piano is entitled to breathe with, and a
   * walker who muted the wind did not ask for the world to stop having weather.
   * It costs four curve writes every ten seconds or so.
   */
  function pumpWind(now) {
    const w = TUNING.wind;
    let guard = 0;
    while (nextGustAt < now + w.lookaheadS && guard++ < 8) {
      const at = Math.max(nextGustAt, now + 0.05);
      const weather = windiness(at - openedAt, windPhase);
      // A curve may not overlap another curve on the same param — the engine
      // throws, and a throw in a frame loop is not a small thing — so a voice is
      // only free once the last gust it was given has finished, with a hundredth
      // of a second of daylight rather than an equality of floats.
      const voice = voices.find((v) => v.freeAt + 0.01 <= at);
      if (!voice) {
        // Three already sounding. The gust is not dropped, it is late: dropping
        // it would quietly make the windiest weather the calmest.
        nextGustAt = at + 1.5;
        continue;
      }
      const rise = between(w.riseS[0], w.riseS[1]);
      const fall = between(w.fallS[0], w.fallS[1]);
      const lo = w.peakStill[0] + (w.peakWindy[0] - w.peakStill[0]) * weather;
      const hi = w.peakStill[1] + (w.peakWindy[1] - w.peakStill[1]) * weather;
      scheduleGust(voice, at, rise, fall, between(lo, hi));
      const gapLo = w.gapStillS[0] + (w.gapWindyS[0] - w.gapStillS[0]) * weather;
      const gapHi = w.gapStillS[1] + (w.gapWindyS[1] - w.gapStillS[1]) * weather;
      // Counted from the crest, so a long fall under a short gap is an overlap.
      nextGustAt = at + rise + between(gapLo, gapHi);
    }
  }

  /** How hard it is blowing right now, nought to one. The same arithmetic that
   *  opened the gains, evaluated rather than measured. */
  function gustAt(now) {
    let sum = 0;
    for (let i = 0; i < gusts.length; i++) {
      const g = gusts[i];
      if (now < g.at || now > g.at + g.span) continue;
      sum += gustShape((now - g.at) / g.span, g.riseFrac, TUNING.wind.fallCurve) * g.level;
    }
    return clamp(sum, 0, 1);
  }

  function buildGraph() {
    // The soft ceiling, and the halving and doubling that let its curve cover an
    // input range of ±2. Three nodes and no state: on the default setting this
    // path is arithmetically the identity, which is a thing the harness checks
    // rather than a thing this comment asserts.
    nodes.ceilingIn = context.createGain();
    nodes.ceilingIn.gain.value = 0.5;
    nodes.ceiling = context.createWaveShaper();
    nodes.ceiling.curve = ceilingCurve(TUNING.ceiling);
    nodes.ceiling.oversample = 'none';
    nodes.ceilingOut = context.createGain();
    nodes.ceilingOut.gain.value = 2;
    nodes.ceilingIn.connect(nodes.ceiling).connect(nodes.ceilingOut)
      .connect(context.destination);

    nodes.master = context.createGain();
    // Never a hard start. The last thing the walker did was click to come in,
    // and a world that answers a click by switching a soundscape on reads as a
    // switch rather than as a place.
    nodes.master.gain.value = 0;
    nodes.master.gain.setTargetAtTime(1, context.currentTime, waking ? WAKE.masterTau : 0.5);
    // THE MUFFLE, WHERE THE WHOLE MIX HAS TO PASS THROUGH IT, and only when the
    // opening scene asked for it. Between the master and the soft ceiling and
    // nowhere else: everything this world makes — the feet, the wind, the piano
    // — is heard through one wall rather than through four, and the ceiling
    // still sees the same signal it always saw, only with its top gone for the
    // first three seconds. With the scene off, the else is the line that was
    // here before this existed, unchanged, and `nodes.wakeFilter` is not a
    // property of the graph at all.
    if (waking) {
      nodes.wakeFilter = context.createBiquadFilter();
      nodes.wakeFilter.type = 'lowpass';
      nodes.wakeFilter.frequency.value = WAKE.startHz;
      nodes.wakeFilter.Q.value = WAKE.q;
      nodes.master.connect(nodes.wakeFilter).connect(nodes.ceilingIn);
    } else {
      nodes.master.connect(nodes.ceilingIn);
    }

    nodes.world = context.createGain();
    nodes.world.gain.value = worldLevel();
    nodes.world.connect(nodes.master);

    nodes.music = context.createGain();
    nodes.music.gain.value = musicLevel() * TUNING.mix.music;
    nodes.music.connect(nodes.master);

    // The instrument, and everything that decides what it plays, hanging off the
    // music bus so the ladder and the mix above it mean exactly what they meant
    // when there was a recording there instead.
    melody = createMelody({
      context, destination: nodes.music, base, character: wantedCharacter(),
    });
    melody.firstDelayS = TUNING.music.firstDelayS;

    nodes.steps = context.createGain();
    nodes.steps.gain.value = TUNING.mix.steps;
    nodes.steps.connect(nodes.world);

    buildWind();
  }

  async function fetchBuffer(url, priority) {
    // `priority` is a hint and browsers that do not know it ignore the member,
    // which is the whole reason it is worth using: there is no fallback to write.
    const response = await fetch(url, priority ? { priority } : undefined);
    if (!response.ok) throw new Error(`${url} (${response.status})`);
    return context.decodeAudioData(await response.arrayBuffer());
  }

  function load() {
    const at = (file) => `${base}${file}`;
    const failed_ = (error) => console.warn(`suono non caricato: ${error.message}`);
    fetchBuffer(at(FILES.steps))
      .then((steps) => { sprite = steps; spriteDelay = codecDelay(steps); })
      .catch(failed_);

    // THE PIANO IS ASKED FOR IN THE SAME GESTURE, and at low priority.
    //
    // The first cut chained the music behind everything else arriving AND
    // decoding, which was the right instinct — it was by far the largest thing
    // in the package and by far the least urgent thing in the world — and it
    // cost thirteen seconds to the first note. Thirteen seconds is a walker who
    // has already decided this world has no music in it.
    //
    // `priority: 'low'` says the same thing to the fetch queue without saying it
    // to the clock: the sprite and the world's own textures keep the head of the
    // queue, and the piano uses what is left, starting now.
    melody.load();
  }

  function start() {
    if (started || failed) return;
    started = true;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      context = new Ctor({ latencyHint: 'interactive' });
    } catch {
      failed = true;
      return;
    }
    buildGraph();
    applyChoices();
    // The melody's clock starts HERE, in the gesture, before a single byte of it
    // has been asked for. If the package arrives late the first phrase is already
    // overdue and sounds the moment it can; if it arrives early it waits. Either
    // way the walker's experience of "when does the music start" is measured from
    // the only event they took part in.
    openedAt = context.currentTime;
    melody.open(openedAt);
    load();
  }

  /**
   * Muffled to clear, over the length of somebody opening their eyes.
   *
   * ONE CALL DOES THE WHOLE OF IT: it arms the filter, it opens the context —
   * this IS the gesture, so it is the one task allowed to — and it starts the
   * sweep. That is not a convenience, it is what makes the muffle possible: the
   * flag has to be true before buildGraph runs, and buildGraph runs inside
   * start(), so an "arm now, open later" pair would either have to rewire a
   * live graph or be called twice by every caller.
   *
   * THE SWEEP RUNS ON THE AUDIO CLOCK, and that is the whole synchronisation.
   * Nothing here is stepped per frame and nothing here asks what time it is
   * again: the ramp is written once, ahead, on the same clock the mix is played
   * on, so a main thread that disappears for a second — and during this arrival
   * it does — cannot make the hearing arrive late. The blinks are on the
   * compositor and this is on the audio thread, and the two agree because they
   * were given the same number, not because anybody keeps them in step.
   *
   * Exponential and not linear, because pitch is what an ear hears: a linear
   * sweep from 560 to 16000 spends its first half getting to eight kilohertz,
   * which is most of the audible way, in a picture where the eyes are still shut.
   *
   * Idempotent: a second ask is ignored rather than restarting the sweep.
   *
   * @param {number} durationMs how long the opening takes — the same number the
   *   scene's own blinks are drawn over
   */
  function wake(durationMs = 3550) {
    if (waking) return;
    waking = true;
    wakeSeconds = Math.max(0.05, (Number.isFinite(durationMs) ? durationMs : 3550) / 1000);
    start();
    // A machine that cannot decode the package, or a graph that was somehow
    // already standing when the ask came: the world is not left silent for it,
    // it simply arrives unmuffled.
    if (!context || failed || !nodes.wakeFilter) return;
    const now = context.currentTime;
    const hz = nodes.wakeFilter.frequency;
    hz.cancelScheduledValues(now);
    hz.setValueAtTime(WAKE.startHz, now);
    hz.exponentialRampToValueAtTime(WAKE.endHz, now + wakeSeconds);
  }

  // ------------------------------------------------------------------ voices

  function playFootfall(state) {
    const t = TUNING.step;
    const grass = state.surface === 'erba';
    const foot = state.foot ? 1 : 0;
    const first = (grass ? SPRITE.surfaces.erba : SPRITE.surfaces.pietra) + foot * SPRITE.perFoot;
    // Never the sample this foot played last: four to choose from with one
    // ruled out is what keeps a walk from ticking.
    const seen = (grass ? 0 : 2) + foot;
    let pick = first + Math.floor(Math.random() * SPRITE.perFoot);
    if (pick === lastPick[seen]) {
      pick = first + ((pick - first + 1 + Math.floor(Math.random() * (SPRITE.perFoot - 1)))
        % SPRITE.perFoot);
    }
    lastPick[seen] = pick;

    const source = context.createBufferSource();
    source.buffer = sprite;
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * t.pitchJitter;
    const gain = context.createGain();
    gain.gain.value = Math.max(0, (grass ? t.grassGain : t.stoneGain)
      * (1 - t.impact - t.effort
        + t.impact * clamp(state.footImpact, 0, 1.4)
        + t.effort * clamp(state.effort, 0, 1))
      * (1 + (Math.random() * 2 - 1) * t.gainJitter));
    const pan = context.createStereoPanner();
    pan.pan.value = foot ? t.footPan : -t.footPan;
    source.connect(gain).connect(pan).connect(nodes.steps);

    // WHERE THE SOUND IS PUT IN TIME, which is the whole of the synchronisation.
    // How far into the step the reporting frame already is says how late the
    // report is; scheduling one fixed lead ahead and taking that lateness off
    // it turns the frame's jitter into a constant, and a constant is a thing an
    // ear does not hear.
    const late = state.cadenceHz > 0.05 ? state.footPhase / state.cadenceHz : 0;
    const when = context.currentTime + Math.max(0, t.leadMs / 1000 - late);
    source.start(when, pick * SPRITE.slotSeconds + spriteDelay, SPRITE.slotSeconds);
    source.onended = () => pan.disconnect();
  }

  const api = {
    /** The live mix, so it can be tasted while walking. */
    tuning: TUNING,

    /** The buses, for the harness that has to hear each of them on its own. */
    get nodes() { return nodes; },
    get context() { return context; },
    /** Whether this machine can decode the package at all. */
    get available() { return supported; },
    get ready() { return Boolean(sprite); },
    get running() { return Boolean(context) && context.state === 'running'; },
    /** What the last frame of this cost, in microseconds. */
    get costUs() { return costUs; },

    /**
     * HOW HARD THE WIND IS BLOWING, NOUGHT TO ONE. Public, and stable.
     *
     * This is the state the music is invited to breathe with: nought is the
     * quiet floor between gusts, one is a gust at its crest, and everything
     * between is a gust on its way up or on its way down. It is not a
     * measurement of the audio — it is the very number that opened the gains,
     * read off the same arithmetic, so a consumer and the wind cannot disagree.
     *
     * THE CONTRACT, so that nobody has to guard it:
     *   * it is always a finite number in [0, 1] — before the first gesture,
     *     with the sound muted, on a machine that cannot decode anything, and
     *     after every voice has been sent away;
     *   * it is nought whenever there is no running audio clock, because there
     *     is then no «now» for a gust to be at;
     *   * it moves over SECONDS, not frames: a gust mounts in two to five and
     *     dies in four to ten, so a consumer may smooth it or read it raw;
     *   * it is read, never written.
     *
     * It is also pushed: if the melody exposes `setWindGust(gust)` it is called
     * once a frame with this number, before its own pump. Either wire works; a
     * unit that wants neither is unaffected.
     */
    get windGust() {
      return (context && context.state === 'running') ? gustLevel : 0;
    },

    get worldChoice() { return worldChoice; },
    get musicChoice() { return musicChoice; },

    setWorld(next) {
      worldChoice = next in LEVELS ? next : 'basso';
      storeChoice(STORAGE.world, worldChoice);
      applyChoices();
      return worldChoice;
    },

    setMusic(next) {
      musicChoice = next in LEVELS ? next : 'basso';
      storeChoice(STORAGE.music, musicChoice);
      applyChoices();
      return musicChoice;
    },

    /**
     * The piano itself, for the listening panel and for the day and night this
     * world will have: `farfield.audio.melody.setCharacter('B')` and
     * `farfield.audio.melody.setNight(1)`.
     */
    get melody() { return melody; },
    get characters() { return CHARACTERS; },

    /**
     * Builds the context, inside the gesture that is allowed to ask for one.
     *
     * Idempotent: the gesture that gets here may be a click or a key, and both
     * are listened for.
     */
    start,

    /**
     * The waking: the context opened, and the mix uncovered over `durationMs`.
     *
     * The only thing the opening scene asks of this unit, and it is asked with
     * one number — how long the eyes take. Everything else about the waking
     * belongs to the scene. Idempotent, and a no-op afterwards.
     */
    wake,

    /**
     * One frame of world, heard.
     *
     * The call site passes four arguments — the frame's seconds, the body, the
     * camera and the position — and two of them are no longer read. They were
     * the water's: where the walker was decided its level, and which way the
     * head was pointing decided its side. Nothing that is left here depends on
     * where the walker is standing. The signature is kept as it is because
     * src/main.js is not this unit's to edit and a shorter one would work
     * identically from there, which is the same reason not to widen it back.
     *
     * @param {number} dt seconds — unread, and the first argument at the call site
     * @param {object} state what the body is doing: presence.state
     */
    update(dt, state) {
      if (!context || context.state !== 'running') return;
      const from = performance.now();
      const now = context.currentTime;

      // THE FEET, read as an event and never as a phase. The body counts the
      // crossings for exactly this, so a slow frame plays one footfall rather
      // than missing it or playing two.
      if (sprite) {
        if (lastFootfall < 0) lastFootfall = state.footfall;
        else if (state.footfall !== lastFootfall) {
          lastFootfall = state.footfall;
          playFootfall(state);
        }
      }

      // THE WEATHER, placed ahead on the audio clock for the same reason: a slow
      // frame moves no gust that has already been written.
      pumpWind(now);
      gustLevel = gustAt(now);

      // THE PIANO, which schedules itself ahead on the audio clock. All this
      // frame owes it is the time: a slow frame, or a frame that never came,
      // moves nothing that has already been placed.
      //
      // AND IT IS TOLD WHAT THE WIND IS DOING, if it wants to know. This is the
      // only wire between this unit and the piano's, and it is optional on
      // purpose: an instrument that does not implement `setWindGust` is not one
      // that is broken, it is one that has not asked. The same number is on
      // `audio.windGust` for anything that would rather pull than be pushed.
      if (melody) {
        if (melody.setWindGust) melody.setWindGust(gustLevel);
        melody.pump(now);
      }

      costUs = (performance.now() - from) * 1000;
    },

    /** What the mix is set to, for the measurement that has to check it. */
    levels() {
      const piano = melody ? melody.stats() : null;
      return {
        world: worldLevel(),
        music: musicLevel(),
        mix: { ...TUNING.mix },
        spriteDelayMs: spriteDelay * 1000,
        windGust: api.windGust,
        windiness: context ? windiness(context.currentTime - openedAt, windPhase) : 0,
        gusts: gusts.map((g) => ({ at: g.at - openedAt, span: g.span, level: g.level })),
        // The promise this unit makes about the melody is the first of these:
        // where the first note landed, counted from the gesture.
        musicFirstNoteS: piano ? piano.firstNoteS : null,
        musicReadyS: piano ? piano.readyS : null,
        character: piano ? piano.character : null,
        phrases: piano ? piano.phrases : 0,
        notes: piano ? piano.notes : 0,
        uniquePhrases: piano ? piano.unique : 0,
      };
    },
  };

  // WHICH CHARACTER, FROM THE ADDRESS BAR — this is the listening panel.
  //
  // The four are a question for the committente and not a setting for a visitor,
  // so there is no control for them in the menu and no key bound in an ordinary
  // page. `?melodia=A` picks one; with that in the address, J walks round the
  // four without a reload, so they can be judged against each other in the same
  // ears and the same minute. A page without `melodia` in its query never adds
  // the listener at all.
  function wantedCharacter() {
    try {
      const asked = new URLSearchParams(window.location.search).get('melodia');
      const key = asked ? asked.toUpperCase() : '';
      return CHARACTERS[key] ? key : DEFAULT_CHARACTER;
    } catch {
      return DEFAULT_CHARACTER;
    }
  }

  function installPanel() {
    let asked = null;
    try {
      asked = new URLSearchParams(window.location.search).get('melodia');
    } catch { return; }
    if (asked === null) return;
    const order = Object.keys(CHARACTERS);
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'KeyJ' || event.repeat || !melody) return;
      const next = order[(order.indexOf(melody.character) + 1) % order.length];
      melody.setCharacter(next);
      console.info(`melodia: ${next} — ${CHARACTERS[next].label}`);
    });
  }
  installPanel();

  // Installed here rather than left to the caller because the rule it exists
  // for is this module's own: a context asked for before a gesture is refused
  // and complains in the console, and the click that opens this world is
  // already there to be used.
  if (auto) {
    const once = { once: true, capture: true };
    window.addEventListener('pointerdown', start, once);
    window.addEventListener('keydown', start, once);
  }

  return api;
}
