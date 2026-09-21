// THE OPENING SCENE.
//
// FARFIELD stands on the celestial pole: the one still point of a sky that
// turns all the way round it. The trails are the time passing while the world
// gets itself ready; the bar is the visitor's own trail, their star closing its
// arc. At the gesture the hearing wakes before the sight — muffled to clear —
// then the eyes open in rising blinks, and only then does the arrival veil this
// world already had begin its ordinary course.
//
// The quiet around the name is not a vignette painted over the picture. It is
// PHYSICAL: a long exposure draws every star through the same ANGLE, so a star
// near the pole draws a short stub and one at the edge draws a long streak, and
// the sampling is uniform per unit AREA, so a ring near the pole holds few of
// them. Those two facts alone empty the middle of the frame. Everything the
// title needs in order to be read is therefore something the sky was doing
// anyway, which is why it does not look like a device.
//
// THE WAKING IS ON THREE CLOCKS AND IN STEP WITH ITSELF ANYWAY. The lids are a
// CSS animation on the compositor, the hearing is an exponential sweep written
// ahead on the audio thread's own clock, and the focus is two uniforms driven
// from the frame loop. None of the three asks either of the others what time it
// is. They agree because they were handed the same table, which is the only
// kind of agreement that survives a main thread disappearing for a second — and
// during this arrival, measured, it does.
//
// The sheet travels with this module and with nothing else. That is what makes
// the whole scene free when it is switched off: no import, no chunk, no
// stylesheet, not one byte on the wire.
import './intro.css';
// THE SKY ITSELF, WHICH THIS SCENE NO LONGER OWNS ALONE.
//
// Every knob that decides the night — where the pole sits, how many arcs, how
// long they are, how bright, how long a turn takes, what the quiet is — and
// every loop that draws one now lives in src/ui/notte.js, because a second
// place draws the same sky: when the bench gives this machine a framing smaller
// than its window (src/core/inquadratura.js), what stands around the world is
// this night, on the same window, about the same pole.
//
// NOTHING ABOUT THE PICTURE MOVED. The constants are the constants, the loops
// are the loops, the generator is seeded with the same words; the pixels this
// scene lays down are the same pixels, which is checked rather than asserted —
// the two bitmaps are deterministic, so their hashes before and after the
// extraction are the proof. What is left in THIS file is what only a scene has:
// the name, the sentence, the orbit and its comet, the lids of the waking, the
// ledger and the gesture.
import {
  clamp01,
  paintField as NOTTE_paintField,
  paintTrails as NOTTE_paintTrails,
  POLE_Y,
  seedGlints as NOTTE_seedGlints,
  smoothstep,
  SPARK_MS,
  SPIN_MS,
  twinkle as NOTTE_twinkle,
} from './notte.js';

// ---------------------------------------------------------------- the ledger

// What each phase of the load is worth, from the approved plan. They are not
// equal because the waits are not equal: the walkable frame is four and a third
// megabytes and half the arithmetic, the calibration is three seconds of
// nothing arriving at all, and dressing the ground is a stall rather than a
// download.
const WEIGHTS = {
  critical: 0.50, dress: 0.06, plant: 0.20, engrave: 0.08, bench: 0.12,
};

// AND THE LAST FOUR PER CENT IS NOT ANY OF THEM. It is paid only when every
// phase above has closed, which is what keeps the hundred honest: the end of
// this bar is an event that happened, never a curve carried the rest of the way
// by a guess about how long the remainder usually takes.
const CLOSE = 0.04;

// ------------------------------------------------------- the knobs of taste
//
// Everything below is a NUMBER SOMEBODY CHOSE, and the choosing is not finished
// until the committente has looked at it on their own screen. They are gathered
// here, each with the reason it is what it is, so that tuning the picture is a
// line of arithmetic and not an excavation.

/** THE ORBIT. The bar is not a bar: it is the trail CLOSEST TO THE POLE, the
 *  one whose circle is small enough to close while the world loads, and the
 *  visitor is the star drawing it. It goes all the way round the name, starts
 *  at twelve o'clock and travels the way the sky travels, and the world is
 *  ready at the instant its circle closes.
 *
 *  How far out it runs: clear of the block by this much air, which is the one
 *  knob of its size. The block is wide and flat, so the radius is set by the
 *  half-diagonal — the corner of the type — and the clearance above and below
 *  is larger than the number says. */
const ORBIT_MARGIN_REM = 2.1;

/** The trail's own weight, and how it ramps. It is faint where it began at
 *  twelve o'clock and full at the head, so what is drawn is a comet's tail and
 *  not a gauge filling up: the closer the orbit is to closing, the brighter its
 *  head burns. Both are alphas of #e8f8ff over the night. */
const ORBIT_TAIL_ALPHA = 0.32;
const ORBIT_HEAD_ALPHA = 0.92;
const ORBIT_WIDTH = 2.2;

/** AND THE RAMP IS CYCLIC, WHICH IS WHAT MAKES IT A COMET.
 *
 *  It used to fade to NOTHING over the first eight degrees at twelve o'clock,
 *  so that the tail did not begin with a cut edge. That was right about the
 *  beginning and wrong about the end: when the circle finally closed, the head
 *  came back to twelve o'clock at 0.92 and stood next to a tail at 0.00, which
 *  is a step of the whole ramp — «sfumata all'inizio, netta alla fine», in the
 *  committente's own frames.
 *
 *  So the ramp now runs between the two ends of ITSELF: it begins at
 *  ORBIT_TAIL_ALPHA, the cyclic minimum, and climbs to ORBIT_HEAD_ALPHA. Round
 *  the whole circle there is then exactly ONE place where the maximum meets the
 *  minimum, and it is at twelve o'clock — which is where the head is at the one
 *  moment the circle is whole. The seam is under the star's own glow BY
 *  CONSTRUCTION, and it stays there, because from that moment the ring turns
 *  rigidly with the star (see ORBIT_IDLE_MS): the gradient travels with the
 *  head instead of being nailed to the frame. Nothing needs to be crossfaded
 *  into anything at the handover, because the ring of the load and the ring of
 *  the comet are the same picture.
 *
 *  What is left at twelve o'clock during the load is the tail's own end at the
 *  cyclic minimum, against the unwalked track at 0.11 — a trail beginning,
 *  which is what it is. */

/** The cyan the trail is wrapped in, and how far it reaches. Drawn into the
 *  same bitmap as the trail rather than laid on as a filter: a filter on a
 *  turning element is a repaint, and nothing in this scene repaints. */
const ORBIT_GLOW_ALPHA = 0.34;
const ORBIT_GLOW_SIGMA = 3.4;
const ORBIT_PAD = 14;

/** The path not yet travelled. Barely there — enough that the eye knows the
 *  circle is a circle before the star has been round it.
 *
 *  Handed to the sheet rather than written in it, like every other number that
 *  decides this picture: the alpha stood here unread for two units while the
 *  same 0.11 lived in intro.css, which is a knob that looks like a knob and
 *  turns nothing. */
const ORBIT_TRACK_ALPHA = 0.11;
const ORBIT_TRACK_WIDTH = 1.2;

const ORBIT_HEAD_PX = 7;

/** A HALF THAT HAS NOT SET OUT IS NOT CLOSED, IT IS ABSENT — and that is the
 *  cure for the tick the committente photographed at six o'clock, standing
 *  there before the star had moved at all.
 *
 *  A turning half-plane can uncover half a circle, so a full turn takes two of
 *  them, and their shared edge runs through the pole: it crosses the trail at
 *  twelve o'clock and at six. At rest each window sits EXACTLY on that edge —
 *  it is the only angle at which it uncovers none of its own half — and the
 *  antialiasing of a rotated box does not stop on a pixel boundary. One pixel
 *  of the ring came through at six o'clock, and with its glow that is a tick as
 *  long as the trail is wide.
 *
 *  Nudging the window off the seam cannot help: the edge passes through the
 *  pole whatever angle it is at, so a tilt only moves the leak from one
 *  crossing to the other. Measured, both of them leaked, and the two recombined
 *  to the trail at full strength.
 *
 *  So a window that has nothing to show is TAKEN OFF THE PAGE. The second half
 *  is absent for the whole of the first half of the load — which is exactly the
 *  span the tick was visible for — and the first is absent until the very first
 *  report moves it. Nothing is hidden that would otherwise have been seen: at
 *  the moment either becomes visible the arc it uncovers is nothing wide, and it
 *  grows from there. */

/** AND THE STAR DOES NOT STOP WHEN THE CIRCLE CLOSES. «A orbita completata,
 *  finché l'utente non parte, la stella non si ferma»: the ring stays whole and
 *  the head goes on round it — one turn in this long.
 *
 *  THIS IS THE DIAL FOR HOW FAST, and it is here to be turned by eye: the
 *  degrees a second are 360000 divided by it. It began at 72 s — five degrees a
 *  second — and the committente, watching, asked for faster; twenty-four
 *  seconds is FIFTEEN degrees a second, which is a star clearly travelling
 *  rather than a hand that might be stopped, and still slow enough that nobody
 *  would call it a spinner.
 *
 *  AND THE WHOLE RING TURNS WITH IT, rigidly, on this same clock: the comet's
 *  gradient is not nailed to the frame, it travels with its own head, so the
 *  one seam it has stays under the star's glow wherever the star is. Both
 *  animations are started by the same class and given the same duration and the
 *  same direction, so they keep step by construction and not by being watched.
 *  On the compositor, like everything else that moves in here. */
const ORBIT_IDLE_MS = 24000;

/** THE SENTENCE BREATHES WHILE IT WAITS. «Vorrei che pulsasse dolcemente finché
 *  l'utente non starta.» A slow symmetrical swell between these two, which is a
 *  breath and not a blink: the low end is high enough that the words are legible
 *  at every instant of it, and the period is that of a calm breath rather than
 *  of an indicator. It begins where the crossfade left the sentence — one
 *  --ui-fade later — so nothing steps. */
const PULSE_MS = 3600;
const PULSE_LOW = 0.55;
const PULSE_STILL_LOW = 0.85;

/** HOW THE SCENE ARRIVES, which is the one thing it could not be allowed to do
 *  badly: a load that opens with a bang has already broken the promise it was
 *  built to keep. The committente, watching a test session: «quando parte la
 *  sessione, testi e star trail appaiono di scatto. Voglio che la loro
 *  visualizzazione sia morbida.»
 *
 *  So nothing switches on. Each layer is on the page, drawn and laid out, at
 *  nothing, and then comes up in its own time in the order the eye should read
 *  them: the ground of the night first, then the sky over it — ALREADY TURNING
 *  while it comes up, so the trails are never seen standing still — then the
 *  name, then the sentence under it, and last the visitor's own path: the empty
 *  circle first, and only after it the star that has begun to draw it.
 *
 *  [duration, when it starts] in ms, and a shorter set for a visitor who asked
 *  for no motion — shorter, never instant, because instant is the thing the
 *  setting exists to spare them. */
const ENTRANCE = {
  field: [560, 0],
  trails: [1150, 200],
  title: [560, 380],
  word: [560, 580],
  track: [700, 820],
  star: [560, 1120],
};
const ENTRANCE_STILL = {
  field: [200, 0],
  trails: [280, 40],
  title: [200, 100],
  word: [200, 180],
  track: [240, 240],
  star: [200, 320],
};

/** How long the name is allowed to wait for its own face before giving up and
 *  coming in wearing whatever the system has.
 *
 *  The world's sheet asks for Farfield Sans with `font-display: swap`, which
 *  means the browser draws the fallback and then SUBSTITUTES it the moment the
 *  file lands — and that substitution is a pop, of exactly the kind this
 *  entrance exists to abolish. Measured on a cold load, the file arrived at
 *  2283 ms, behind four megabytes of texture. So the type simply waits: it
 *  arrives in the right face or, past this, in whatever face there is, because
 *  a name that never appears is worse than a name that changes shape.
 *  Comfortably inside the breath, so the sentence is always up and settled
 *  before it can be asked to change. */
const TYPE_WAIT_MS = 1500;

/** And the crossfade a canvas is redrawn under. A repaint at full strength is
 *  the same pop by another name, so the sky goes out, is redrawn while it is
 *  not there, and comes back. */
const SWAP_MS = 200;
const SWAP_STILL_MS = 120;

/** The shortest the whole load is allowed to look, however warm the cache. A
 *  scene that opens and closes in four hundred milliseconds is a flash, not an
 *  arrival, and the committente asked for a breath. */
const BREATH_MS = 2600;

/** HOW LONG A STEP OF THE CHASE TAKES, and this is the whole answer to «il
 *  caricamento è a scatti: voglio animazioni più scorrevoli, delicate,
 *  morbide».
 *
 *  MEASURED FIRST, on the glass, over a whole cold Fast-3G load at CPU x4
 *  (s2-intro/orbita.mjs, section IS IT SMOOTH). What jerkiness actually WAS:
 *  the front stood still for 93.7% of the run, set off again from a standstill
 *  eighteen times, and inside one of those bursts its speed went 111, 409, 97,
 *  137, 45, 74, 7, 15 degrees a second in under four hundred milliseconds. That
 *  last list is the fault: a report arriving mid-step RESTARTED the transition,
 *  and --ui-ease begins at a standstill, so every report the visitor could not
 *  see put a check into the one thing they could.
 *
 *  Three things follow from that, and they are the three numbers here.
 *
 *  1. A STEP IN HAND IS FINISHED BEFORE THE NEXT IS TAKEN. Nothing interrupts
 *     anything any more; a report that lands mid-step is accumulated and
 *     collected when the step ends. Since --ui-ease leaves and arrives at a
 *     standstill, consecutive steps join at zero speed — so the motion has a
 *     CONTINUOUS velocity from end to end, which is what smooth means.
 *  2. A STEP'S LENGTH IS ITS DISTANCE, at a pace. ORBIT_PACE_MS is how long a
 *     WHOLE TURN would take at the star's own speed, so a small report is a
 *     small step and the four-megabyte one — terrain-albedo, which is 74% of
 *     the critical load and lands whole — is a long slow sweep rather than a
 *     snap. It was the snap the committente saw.
 *  3. AND THE FLOOR IS HIGH, because the measurement says the star has time: it
 *     was standing still nineteen twentieths of the load. A floor of 600 ms
 *     bought twitches; this one buys a glide.
 *
 *  The ceiling is what stops a single step from outlasting the visitor's
 *  patience on a warm cache, where the whole ledger can close in one report and
 *  the step is a full turn. */
const ORBIT_PACE_MS = 9000;
const FOLLOW_MIN_MS = 1200;
const FOLLOW_MAX_MS = 4200;
const FOLLOW_STILL_MS = 300;

/** AND THE LAST STRETCH IS ONE GLIDE, NOT A DRIZZLE OF STEPS.
 *
 *  «L'ultima parte della barra va a scatti — il 5-10% finale — mentre il resto
 *  è fluido.» Measured on a bench that writes the ledger itself
 *  (s2-intro/banco.mjs, cadence `coda-a-goccia`), and the committente is
 *  describing the ledger's own shape rather than anything about the drawing:
 *  the body of the load arrives in a few enormous reports — terrain-albedo
 *  alone is 74% of the critical phase and lands whole — and the tail arrives as
 *  a drizzle. Six engrave ticks are a fortieth of a turn each; the calibration
 *  is binary; the last four per cent is CLOSE. Each of those is its own step,
 *  and because --ui-ease leaves and arrives at a standstill, each of them is a
 *  little movement that starts from rest and dies back to it. The velocity is
 *  continuous — INTRO-D bought that and it is kept — but it keeps RETURNING TO
 *  ZERO inside what the eye reads as one approach, and a movement that stops
 *  five times on its way is the definition of a stutter.
 *
 *  So two rules, and between them the tail is one movement.
 *
 *  1. THE LAST TENTH OF THE CIRCLE BELONGS TO THE CLOSE, AND NOTHING ELSE MAY
 *     SPEND IT. Until the ledger has actually closed, the star may travel no
 *     further than 1 − ORBIT_CLOSE_ARC. It is not an estimate of the hundred
 *     and it never moves for one: it is a floor the chase is not allowed to
 *     cross without the fact. What the visitor sees is a star arriving at the
 *     brink and waiting there — which is true — and then ONE dying approach.
 *     The alternative, measured, is the star creeping to 96% on the calibration
 *     and then twitching the last four per cent home, which is precisely the
 *     five to ten per cent the committente photographed.
 *  2. AND A TWITCH WAITS FOR COMPANY. An update that would move the star less
 *     than ORBIT_STEP_MIN is not a movement, it is a tic; it is held for up to
 *     ORBIT_STEP_WAIT_MS so that whatever else is coming can join it, and the
 *     accumulated distance goes as one step. The wait is BOUNDED, so a ledger
 *     that stops delivering can never leave the star standing.
 *
 *  ORBIT_CLOSE_MS is the floor of that final glide alone. The general floor
 *  would give a tenth of a turn twelve hundred milliseconds, which arrives
 *  briskly; this is the one movement in the whole scene the visitor is actually
 *  waiting for, and it is worth letting it settle. It ends at a standstill for
 *  the same reason everything else here does — --ui-ease, or the same curve cut
 *  in two if the glide crosses six o'clock. */
const ORBIT_CLOSE_ARC = 0.10;
const ORBIT_CLOSE_MS = 1800;
const ORBIT_STEP_MIN = 0.05;
const ORBIT_STEP_WAIT_MS = 900;

/** AND THE HANDOVER AT SIX O'CLOCK DOES NOT STOP EITHER.
 *
 *  The reveal is two turning half-planes, so a step that crosses the halfway
 *  mark is two transitions: the left window finishes its leg and the right
 *  begins, delayed by exactly as long. With --ui-ease on both, the first leg
 *  DECELERATES TO A STANDSTILL at six o'clock and the second sets off from one
 *  — a check in the middle of a single movement, at the same place every time.
 *
 *  So the pair is given ONE curve cut in two. The first half accelerates from
 *  rest and ends at a slope of 1.5; the second starts at a slope of 1.5 and
 *  settles to rest. Because the two legs are handed time in proportion to their
 *  distance, their mean speeds are equal, and equal normalised slopes are
 *  therefore equal speeds: the join is smooth in fact and not by eye. A step
 *  that stays inside one leg uses the interface's own curve, whole. */
const EASE_HALF_IN = 'cubic-bezier(0.5, 0, 0.667, 0.5)';
const EASE_HALF_OUT = 'cubic-bezier(0.333, 0.5, 0.2, 1)';

/** THE ONE THING THE SMOOTHER CHASE UNCOVERED, AND IT IS NOT CURED HERE.
 *
 *  The reveal is two clipped half-planes and their boxes meet on the vertical
 *  through the pole, which crosses the trail at twelve o'clock and at six. For
 *  about nine hundred milliseconds either side of the halfway mark — while the
 *  front is between 45% and 57% of the turn — a hairline three pixels wide
 *  stands across the trail at six o'clock, where the last pixel one half draws
 *  and the first the other draws do not meet. It is not new: at the old pace the
 *  front crossed that stretch in a blink with the star's halo sitting on it, and
 *  slowing the chase down to something worth calling smooth is what put it in
 *  the open.
 *
 *  FOUR CURES WERE BUILT AND MEASURED, and none of them closed it:
 *
 *  * sending each window a degree PAST its own half, so its antialiased edge
 *    would fall outside the clip and the clip's own hard edge take over — this
 *    made it worse, four pixels instead of three, because a degree off a quarter
 *    turn is a resampling where there had been none;
 *  * rounding the pivot to a whole pixel so the quarter turns map the lattice
 *    onto itself — narrowed it, did not close it;
 *  * overlapping the two clip boxes by three pixels so the second half has
 *    somebody to draw the line — no change;
 *  * bringing the whole unclipped ring in early through a thumbnail-sized window
 *    over the spot — this DOES cover it, and it also draws the trail twice
 *    there, which trades a dark bar for a bright one;
 *  * and not promoting the ring canvases to layers of their own — no change.
 *
 *  What would close it is a second half drawn without a clip at all, which is a
 *  different reveal and not a tuning of this one. Declared, measured, and left
 *  for whoever takes it: s2-intro/orbita.mjs prints the frames it lives in.
 *
 *  In the IDLE, where the committente asked for no visible step anywhere on the
 *  ring, there is none: the two halves hand over to a single unclipped canvas
 *  and the seam goes with them (s2-intro/cometa.mjs). */

/** AND THE TWO WINDOWS COME TO REST AT EXACTLY NINETY DEGREES, which is not a
 *  detail: it is the reason the trail has no seam in it.
 *
 *  A quarter turn maps the pixel lattice onto itself, so a layer rotated by
 *  exactly ±90° is resampled by nobody — every pixel of the ring lands whole on
 *  a pixel of the screen, right up to the edge of the clip that ends it. Tilt
 *  it by a degree and the same layer has to be resampled, and what the
 *  resampling cannot reach is the last fraction of a pixel against that clip:
 *  the two halves then meet across a hairline that neither of them draws.
 *
 *  This was found the expensive way. Six o'clock had a black bar cut clean
 *  through the trail — photographed at 51% of the turn, four pixels wide, with
 *  the star an arc away from it — and the first cure was to send each window a
 *  degree PAST its own half so that its soft edge would fall outside the clip
 *  and the clip's own hard edge would take over. Measured, that made it: with
 *  the overshoot the bar is there at 51% and at 75%, and with the overshoot at
 *  nought it is at neither. The clip was never the problem; the tilt was.
 *
 *  So nothing here overshoots anything, and the one place the two halves can
 *  still show a seam — while they are fading out under the comet, when each of
 *  them is a layer of its own — is covered by the handover being a crossfade
 *  and by the star standing on it. */

/** How long the two windows take to hand the ring over to the comet. Long
 *  enough not to be an edge, short enough that nobody waits for it — and what
 *  crosses is a picture into the identical picture, so what it actually covers
 *  is the seam between the two clipped layers going out. */
const ORBIT_HAND_MS = 400;

const WAITING = 'Il viaggio sta per iniziare…';
const READY = 'Clicca per iniziare';

/** How long the night takes to let go of the frame, and the short one for a
 *  visitor who asked their machine for no motion. The number is decided here
 *  and handed to the sheet, the way the veil and the way in both do it, so the
 *  clock that takes the scene off the page cannot disagree with the fade. */
const FADE_MS = 1300;
const REDUCED_FADE_MS = 700;

/** THE WAKING, ON ONE CLOCK, and t = 0 is the visitor's own gesture.
 *
 *  This is the whole of the timeline and it lives HERE, in the scene, because
 *  the scene is the only thing that knows what it is drawing. What leaves this
 *  file is one number: how long it takes. The audio is handed that number and
 *  sweeps its own filter on the audio clock; the lids are handed it and run one
 *  CSS animation each on the compositor; the focus is driven from the frame
 *  loop against the same origin. Nothing keeps anything else in step — the
 *  three agree because they were all given the same table, which is the only
 *  kind of synchronisation that survives a main thread going away for a second.
 *
 *  SCENE is how long the sky takes to dissolve, and it dissolves WHILE IT IS
 *  STILL TURNING: a scene that stopped and then faded would be a scene being
 *  switched off. FIRST is when the lids begin, so the first blink lands after
 *  the star field has already begun to go. VEIL is where the arrival veil this
 *  world already had is handed its cue — everything after that is the ordinary
 *  arrival, unchanged. TOTAL is the eyes fully open and the hearing fully back;
 *  GRACE is the lids' own fade, so the element leaves the page instead of
 *  vanishing off it. */
const WAKE = {
  scene: FADE_MS,
  first: 500,
  span: 3050,
  veil: 3250,
  total: 3550,
  grace: 300,
};

/** THE BLINKS, AS THE APERTURE ITSELF against the clock — how much of the frame
 *  the eyes are letting through, which is what the design's percentages mean
 *  and what anything measuring this from outside can see. The travel that
 *  produces each is worked out below, from the shape of a lid.
 *
 *  Three of them, rising: a third of the way, then most of the way, then all of
 *  it, each with a fall back afterwards that is shorter than the rise. That
 *  shape is what makes it read as an eye winning a fight rather than as a
 *  shutter being operated. */
const BLINKS = [
  [0, 0], [500, 0], [950, 0.30], [1070, 0.30], [1370, 0.06],
  [1870, 0.62], [2020, 0.62], [2320, 0.18], [3250, 1], [3550, 1],
];

/** THE SHAPE OF A LID, and it is an ARC rather than a line.
 *
 *  «La forma di apertura sia meno rettilinea, più morbida, più tonda, come una
 *  vera palpebra.» An eye does not open between two straight edges: the opening
 *  is an almond, tallest down the middle and closing to nothing at the corners,
 *  because the lid's own margin is a curve. So the inner edge of each lid here
 *  is an ellipse arc — LID_ARC_VH lower at the sides of the frame than at its
 *  middle — and it is soft over LID_FEATHER_VH rather than being a line at all.
 *
 *  All four numbers below are in vh and they hold each other up:
 *
 *  * LID_SOLID_VH is how far down the middle of the frame the lid is OPAQUE.
 *    Twice it must clear the frame, or two shut lids would meet in a grey band
 *    instead of a black one. 52 and 52 make 104: four to spare.
 *  * LID_ARC_VH is how much deeper the lid reaches at the left and right edges.
 *    This is the whole of the roundness, and it is the knob for it — SET BY EYE
 *    AND SET TWICE, because the first setting overshot.
 *
 *    «La forma di apertura sia meno rettilinea» took it from a straight edge to
 *    8vh. Watching that: «l'animazione delle palpebre è un po' troppo A
 *    MANDORLA — prima avevo chiesto di farla meno rettilinea, ora ti chiedo di
 *    riportarla come avevi fatto prima (non era troppo lineare)». Going back
 *    literally is not the answer, because what was there before this number
 *    existed was the STRAIGHT edge, and that is the thing that was rejected
 *    first; the committente is asking for the middle of the two, not for either
 *    end. So it is halved.
 *
 *    AND THE OVERSHOOT IS VISIBLE IN A NUMBER, not only in a taste.
 *    s2-intro/palpebre.mjs freezes the waking at a given aperture and reads the
 *    inner edge off the glass column by column, and at the FIRST blink — the
 *    narrow one, 30% open — 8vh put the edge 417 px lower at the sides of a
 *    720 px frame than down its middle. That is not an almond, it is a lid that
 *    is still fully SHUT at both sides while the middle is three hundred pixels
 *    open. At 4vh the same reading is 33 px. Measured at the second blink:
 *    8vh -> 8.8vh of drop, 4vh -> 4.4, 3vh -> 3.3, so the constant means what
 *    it says to within the feather's own half-width.
 *
 *    3vh was built and looked at too, side by side, and is left unused: it is
 *    close enough to the straight edge to be arguing with the first note. 4 is
 *    an arc anybody can see and nobody would call a mandorla.
 *  * LID_FEATHER_VH is how far below the opaque part the lid takes to vanish.
 *    Wider than a filo and deliberately so: what the committente asked to be
 *    "meno netta" is this number.
 *  * LID_VH is the lid's own height AND its throw, because a lid must be able to
 *    leave the frame entirely — measured once when it could not, and the
 *    recording read 98.2% of the frame at the moment the eyes were supposed to
 *    be all the way open. It has to clear the solid, the arc and the feather
 *    together, and it does with a little over.
 *
 *  The aperture down the middle of the frame at a travel g (as a fraction of
 *  LID_VH) is then 2·LID_VH·g − (2·LID_SOLID_VH − 100) — which is what the next
 *  function inverts, because the design speaks in apertures and CSS moves
 *  lids. */
const LID_VH = 80;
const LID_SOLID_VH = 52;
const LID_ARC_VH = 4;
const LID_FEATHER_VH = 14;

/** The travel that shows a given aperture, as a fraction of a lid's height.
 *
 *  ONE IS A SPECIAL CASE AND NOT A ROUNDING. The aperture between the two
 *  opaque edges is already the whole frame well before the lids have left it,
 *  and what is still on the glass after that is the soft part — a shading a
 *  hand's width deep, banked against the top and the bottom. An eye that is
 *  "all the way open" has none of that, so the last blink is given the whole
 *  travel and the end of it is that shade lifting away: which is, as it turns
 *  out, exactly what the last stretch of waking up looks like. */
const travelFor = (aperture) => (aperture >= 1
  ? 1
  : (aperture * 100 + (2 * LID_SOLID_VH - 100)) / (2 * LID_VH));

/** THE FOCUS, on the same clock. It clears at each blink and goes back a little
 *  at each fall: an eye that closes again loses some of what it had just
 *  gained, and a curve that only ever improved would say the blinks were
 *  decoration. The three landings — 0.62, 0.30, 0 — are the design's; the two
 *  rises between them are a knob of taste and are here to be turned.
 *
 *  One is the whole of the defocused copy the world already draws, which is
 *  thirteen pixels wide (params.eye.focusReach in src/core/post.js). */
const WAKE_BLUR = [
  [0, 1.00], [500, 1.00], [950, 0.62], [1070, 0.62], [1370, 0.74],
  [1870, 0.30], [2020, 0.30], [2320, 0.42], [3250, 0],
];

/** And the light. A world too bright for an eye that has been shut, given back
 *  one step per blink and never taken away again: adaptation does not undo
 *  itself between two blinks, so unlike the focus this one only falls. */
const WAKE_EXPOSURE = [
  [0, 1.55], [950, 1.38], [1370, 1.38], [1870, 1.18], [2320, 1.18], [3250, 1.00],
];

/** A visitor who asked their machine for no motion gets none of it: one
 *  crossfade, the hearing opened over a length that suits it, and the arrival
 *  veil straight away. No lids, no focus — a blur that pumps three times is
 *  precisely the thing the setting exists to spare them. */
const REDUCED_WAKE_MS = 1200;

/** THE BIRTH OF THE PICTURE, AND IT COMES BEFORE THE WAKING (E-DECISIONI35, 4).
 *
 *  «Comparirà la forma della finestra esplorabile all'improvviso, e questo non
 *  lo vorrei. Stavo pensando che la circonferenza del caricamento si allargasse
 *  fino a raggiungere, in modo morbido e stile coerente, la dimensione della
 *  finestra esplorabile.»
 *
 *  So the circle the star went round does not fade with the rest of the scene:
 *  it GROWS, over a second and a half, into the rounded rectangle of the
 *  picture, and its cyan becomes that picture's soft border. Only then do the
 *  lids begin. The whole of the waking timeline above is unchanged and simply
 *  starts later — `wokeAt` is set a birth ahead of the gesture — so every
 *  number the design was given still means what it meant.
 *
 *  A SECOND AND A HALF, and the two things it is held between: under a second
 *  the circle arrives before the name has finished dissolving (the scene takes
 *  FADE_MS = 1300 to go) and the two read as one jump; over two the visitor has
 *  already pressed and is waiting, which is the one thing an entrance may not
 *  do. It overlaps the scene's own fade by two hundred milliseconds, which is
 *  what makes it a handover rather than a queue.
 *
 *  HANDOVER is what happens after it lands: the drawn ring fades out while the
 *  halo in the composite — which is the picture's own light, and is cyan for
 *  exactly as long as this lasts — comes up under it. A crossfade of one border
 *  into another, both driven from the same frame and therefore never apart. */
const BIRTH_MS = 1500;
const BIRTH_HANDOVER_MS = 500;

/** AND IT ADVANCES BY FRAMES AND NOT BY MILLISECONDS, WHICH IS THE OPPOSITE OF
 *  EVERYTHING ELSE IN THIS FILE, AND IT IS MEASURED.
 *
 *  The gesture is the busiest instant of the whole arrival: the walker is
 *  engaged, the pointer lock is asked for, an audio context is opened, and the
 *  world's first frames with a defocused copy in them compile the two passes
 *  that draw it. Measured here with a screencast — which delivers the frames
 *  the browser actually DREW — the page went 133 ms and then 712 after the
 *  click: five hundred and eighty milliseconds with nothing on the glass, out
 *  of a growth that is meant to last fifteen hundred.
 *
 *  On a clock, that stall is a border that stands still for six tenths of a
 *  second and then jumps four tenths of its travel in one frame — which is
 *  precisely the «all'improvviso» the committente asked to be rid of, moved
 *  from the beginning of the movement into the middle of it.
 *
 *  So the growth is given a SPEED LIMIT instead of a deadline: each frame
 *  advances it by the time that really passed, capped at this. A frame that
 *  cost sixty milliseconds and one that cost six hundred move the border by the
 *  same amount, so it can never jump; what a stall costs is that the birth ends
 *  later, which is the one thing a visitor cannot see. Sixty is four frames of
 *  a sixty hertz screen: under it an ordinary dropped frame would start
 *  stretching the movement for nothing.
 *
 *  AND THERE IS A CEILING UNDER THAT PROMISE, for the same reason there is one
 *  under the arrival veil's wait (VEIL_GROUND_CAP_MS in src/main.js): a page
 *  that spent the birth in a background tab drew no frames at all, and a border
 *  that waits for frames that will never come is a visitor who never gets in.
 *  Nine hundred milliseconds of slack is longer than the worst stall measured
 *  on the reference machine and shorter than anything a walker would call a
 *  wait. */
const BIRTH_STEP_CAP_MS = 60;
const BIRTH_SLACK_MS = 900;

/** How the circle grows. Soft at BOTH ends — Hermite's smoother cousin, whose
 *  first AND second derivatives are nought at each end — because this movement
 *  has nothing before it and nothing after it: it starts from a standing
 *  circle and it stops on a standing picture, and a curve that arrived with any
 *  speed left would need something to absorb it. */
const grown = (x) => {
  const t = x < 0 ? 0 : (x > 1 ? 1 : x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** THE BORDER WHILE IT IS BEING BORN, drawn as four strokes and not as a blur.
 *
 *  A canvas shadow is the obvious way to make a line glow and it is the wrong
 *  one here: `shadowBlur` is a full blur of the stroke's bounding box, which
 *  during this second and a half is most of the window, on the main thread, on
 *  the frames where the world is taking its first real ones. Four concentric
 *  strokes of falling width and rising opacity are a glow the eye cannot tell
 *  from a blurred one at this scale, and they cost four paths.
 *
 *  The widths are in CSS pixels and the alphas are what they are at full
 *  strength; the colours are the orbit's own (src/ui/intro.css): the cool teal
 *  for the halo and the near-white the star's head is cut in for the line. */
const RING_COATS = [
  [17, 0.055], [10, 0.10], [5, 0.20], [1.7, 0.80],
];
const RING_HALO = '158,236,249';
const RING_LINE = '232,248,255';

/** How a lid moves, and the three shapes are not one shape. Up is a lid FLYING
 *  — most of the travel in the first third — because that is what a muscle
 *  that has just been let go does; down is a lid FALLING, slow to leave and
 *  quick to arrive; and the last opening is the interface's own curve, so the
 *  eyes land on the world with the softness everything else in this world lands
 *  with. Written as numbers rather than as var(--ui-ease): a custom property
 *  read for animation-timing-function inside a keyframe is not a thing every
 *  browser resolves, and this is not the place to find out which. */
const EASE_OPEN = 'cubic-bezier(0.2, 0.7, 0.3, 1)';
const EASE_SHUT = 'cubic-bezier(0.4, 0, 0.7, 0.4)';
const EASE_LAND = 'cubic-bezier(0.5, 0, 0.2, 1)';

const RESIZE_MS = 180;

// ---------------------------------------------------------------- arithmetic

/** A table of [ms, value] read at a time, with the corner taken off every
 *  junction. Hermite and not a straight line for the same reason everything
 *  else in this file is Hermite: a piecewise linear curve has a discontinuous
 *  velocity at every waypoint, and an eye can find one of those in a blur as
 *  easily as in a movement. Held at both ends. */
function rampAt(table, t) {
  if (t <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const [t1, v1] = table[i];
    if (t > t1) continue;
    const [t0, v0] = table[i - 1];
    return v0 + (v1 - v0) * smoothstep(t0, t1, t);
  }
  return last[1];
}

/** The two @keyframes of the lids, built from the one table above.
 *
 *  Built rather than written into the sheet because BLINKS is the timeline and
 *  a second copy of it in CSS percentages is a second thing to keep true. What
 *  the sheet holds is what a sheet is for — that the lids are black, that their
 *  inner edge is soft, and that the only property either of them ever animates
 *  is a translation, which is the compositor's.
 *
 *  ONE ANIMATION EACH, of WAKE.span, delayed by WAKE.first, held at the end.
 *  Per-keyframe timing functions carry the three shapes: the segment beginning
 *  at a keyframe is drawn with the curve declared on it. */
function lidKeyframes() {
  const steps = BLINKS.filter(([t]) => t >= WAKE.first);
  const eases = [EASE_OPEN, 'linear', EASE_SHUT, EASE_OPEN, 'linear', EASE_SHUT, EASE_LAND];
  // THE TRAVEL IS A PERCENTAGE OF THE LID'S OWN HEIGHT AND NO LONGER OF THE
  // GLASS (E-DECISIONI35, point 2). The lid is LID_VH per cent of the PICTURE
  // and the travel is a fraction of the lid, so a fraction times a hundred is
  // the same movement it always was — expressed in the one unit that follows
  // the picture when the picture is smaller than the window. Nothing about the
  // timeline, the curves or the apertures moves: this is the same number in
  // another denominator.
  const frames = (sign) => steps.map(([t, aperture], i) => {
    const pc = ((t - WAKE.first) / WAKE.span) * 100;
    const y = sign * travelFor(aperture) * 100;
    const ease = i < eases.length ? `animation-timing-function:${eases[i]};` : '';
    return `${pc.toFixed(3)}%{transform:translateY(${y.toFixed(3)}%);${ease}}`;
  }).join('');
  return `@keyframes intro-lid-up{${frames(-1)}}\n`
    + `@keyframes intro-lid-down{${frames(1)}}`;
}

/** Whether a key press means "let me in" rather than something else entirely.
 *
 *  Escape and Tab belong to the interface behind this and would arrive at it
 *  the moment the scene let go; a modified press is a browser command, not a
 *  visitor; and a modifier on its own is a hand resting, not a decision. */
function isEntry(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  if (event.code === 'Escape' || event.code === 'Tab') return false;
  return !/^(Shift|Control|Alt|Meta)/.test(event.code);
}

// --------------------------------------------------------------- the picture

/**
 * Hangs the opening scene over the page and hands the world on when it is done.
 *
 * @param {HTMLElement} root      the interface layer this lives in
 * @param {HTMLElement} cover     the opaque sheet main.js laid down first
 * @param {object}      bus       the progress ledger: { fractions, sink }
 * @param {Function}    onGesture the visitor has asked to come in
 * @param {Function}    onAwake   the world is theirs
 */
export function createIntro({
  root, cover, bus, onGesture, onAwake, quadro = null,
}) {
  const still = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fadeMs = still ? REDUCED_FADE_MS : FADE_MS;

  const entrance = still ? ENTRANCE_STILL : ENTRANCE;
  const swapMs = still ? SWAP_STILL_MS : SWAP_MS;
  // When the last layer has finished arriving. Nothing waits on this except
  // the choice of how to redraw: during the entrance a canvas is already at
  // low strength and can simply be repainted, after it the swap has to be a
  // crossfade of its own.
  const entranceMs = Math.max(...Object.values(entrance).map(([d, at]) => d + at));

  const el = document.createElement('div');
  el.className = still ? 'intro is-still' : 'intro';
  el.style.setProperty('--intro-fade', `${fadeMs}ms`);
  el.style.setProperty('--intro-spin', `${SPIN_MS}ms`);
  el.style.setProperty('--intro-swap', `${swapMs}ms`);
  // The two lives of the wait, both settled here and both spent on the
  // compositor: how long the star takes to go round its finished trail, and how
  // slowly the sentence breathes. A visitor who asked for no motion keeps the
  // breath — a page with nothing alive on it reads as a page that has stopped —
  // but it is a much shallower one, and the star stands still.
  el.style.setProperty('--intro-idle', `${ORBIT_IDLE_MS}ms`);
  el.style.setProperty('--intro-pulse', `${PULSE_MS}ms`);
  el.style.setProperty('--intro-pulse-low', `${still ? PULSE_STILL_LOW : PULSE_LOW}`);
  el.style.setProperty('--intro-track-alpha', `${ORBIT_TRACK_ALPHA}`);
  el.style.setProperty('--intro-hand', `${still ? SWAP_STILL_MS : ORBIT_HAND_MS}ms`);
  // The schedule, handed to the sheet one line at a time. The sheet holds WHICH
  // property each layer comes up on and this holds WHEN, because when is a
  // matter of the picture and the picture is decided here.
  for (const [layer, [ms, at]] of Object.entries(entrance)) {
    el.style.setProperty(`--in-${layer}`, `${ms}ms`);
    el.style.setProperty(`--in-${layer}-at`, `${at}ms`);
  }
  el.innerHTML = `
    <canvas class="intro-field" aria-hidden="true"></canvas>
    <canvas class="intro-trails" aria-hidden="true"></canvas>
    <canvas class="intro-spark" aria-hidden="true"></canvas>
    <div class="intro-block">
      <h1>Farfield</h1>
      <p class="intro-word"><span class="is-on"></span><span></span></p>
    </div>
    <div class="intro-orbit" aria-hidden="true">
      <i class="intro-orbit-track"></i>
      <div class="intro-orbit-half is-first">
        <div class="intro-orbit-wipe"><canvas class="intro-orbit-ring"></canvas></div>
      </div>
      <div class="intro-orbit-half is-second">
        <div class="intro-orbit-wipe"><canvas class="intro-orbit-ring"></canvas></div>
      </div>
      <canvas class="intro-orbit-comet"></canvas>
      <div class="intro-orbit-arm"><div class="intro-orbit-swing"><i class="intro-orbit-head"><i class="intro-orbit-halo"></i></i></div></div>
    </div>
  `;

  const field = el.querySelector('.intro-field');
  const trails = el.querySelector('.intro-trails');
  const spark = el.querySelector('.intro-spark');
  const block = el.querySelector('.intro-block');
  const words = el.querySelectorAll('.intro-word span');
  const orbit = el.querySelector('.intro-orbit');
  const track = el.querySelector('.intro-orbit-track');
  const halves = el.querySelectorAll('.intro-orbit-half');
  const wipes = el.querySelectorAll('.intro-orbit-wipe');
  const rings = el.querySelectorAll('.intro-orbit-ring');
  // THE COMET IS A THIRD COPY OF THE RING, WHOLE AND UNCLIPPED, and it exists
  // because of what the two halves cost once they have nothing left to hide.
  //
  // The reveal is two clipped half-planes and their boxes meet on the vertical
  // through the pole — which crosses the trail at twelve o'clock and at six. A
  // clip is exact, but the layer inside it is rasterised and composited, and at
  // that shared edge the two layers leave a hairline: measured, a black bar cut
  // clean through a two-pixel trail, four pixels wide at six o'clock, standing
  // there for the whole of the idle. (It was invisible before only because the
  // star crossed six o'clock in a few hundred milliseconds and its glow covered
  // it; slowed to something worth calling smooth, it stands in the open.)
  //
  // Once the circle is closed there is nothing left for the two windows to do,
  // so what turns is a single canvas with no clip on it at all — no seam,
  // anywhere, at any phase — and the handover is a crossfade of a picture into
  // the identical picture, which is the softest kind there is.
  const comet = el.querySelector('.intro-orbit-comet');
  // THE ARM IS TWO ARMS, and that is the cure for the second fault in the
  // committente's frames: past the halfway mark a second lit segment set off
  // from six o'clock WITH the star on it, while the real front was still coming
  // down the left, and a dark gap stood between them.
  //
  // The cause was three transitions interpolating three quantities that are not
  // linear functions of one another. The left window's angle is the progress
  // CLAMPED at a half turn and the right window's is the progress MINUS a half
  // turn, also clamped; the head's is the progress itself. Interpolating each of
  // those independently over the same duration does not give the clamp of an
  // interpolated progress — so on the one update that crosses the half, the left
  // window was still travelling towards six o'clock while the right had already
  // left it, and the head, which is neither, stood over the second one.
  //
  // Now there is ONE angle and the rest are it: the outer arm carries the first
  // half turn and the inner the second, so the head's total is exactly the sum
  // of the two windows' travels — by construction, on every frame, whatever the
  // timing does. And the timing is split with it: an update that crosses the
  // half gives each leg the share of the duration that belongs to its share of
  // the travel, and delays the second by the first, so at any instant exactly
  // ONE of the two is moving and the head is on the front of the one that is.
  const arm = el.querySelector('.intro-orbit-arm');
  const swing = el.querySelector('.intro-orbit-swing');
  const head = el.querySelector('.intro-orbit-head');
  words[0].textContent = WAITING;
  words[1].textContent = READY;

  // CARICO -> PRONTA -> RISVEGLIO -> FINITA. The gesture is only heard in
  // PRONTA; everything before it is swallowed, which is not merely tidiness —
  // the calibration runs behind this sheet, and today a stray click stops it.
  let state = 'carico';
  const born = performance.now();

  // Where the sky turns, how far it reaches, and how much of it round the pole
  // the name has to itself. All three are measured, never assumed: R_q holds
  // the block that is actually on the page at the size the browser gave it.
  let poleX = 0;
  let poleY = 0;
  let rOut = 1;
  let rQuiet = 1;
  let rOrbit = 1;
  // The six of them together, for the sky: see the foot of measure().
  let geom = { width: 1, height: 1, poleX: 0, poleY: 0, rOut: 1, rQuiet: 1 };
  const ringSrc = document.createElement('canvas');

  let shown = 0;
  let target = 0;
  // The star does not begin to draw before the circle it draws on is there.
  // Until then the ledger is still read and still accumulated — nothing is
  // lost — it is only that the first reveal is held back to the moment the
  // track has finished fading in, so what the visitor sees start is a star
  // setting out on a path, and not a path and a star at once.
  let held = true;
  let holdTimer = null;
  let swapTimer = null;
  let typeTimer = null;
  let arrived = false;
  // Whether a step of the chase is in flight, how many of its legs have still
  // to report, and the clock that ends it whatever they do. See chase(): a
  // report arriving mid-step is accumulated, never a restart.
  let stepping = false;
  let stepLegs = 0;
  let stepTimer = null;
  let landTimer = null;
  // A step too small to be a movement is held back for whatever is coming
  // behind it, for at most ORBIT_STEP_WAIT_MS. `waitDue` is that wait having
  // expired: the next chase takes what it has, however little.
  let waitTimer = null;
  let waitDue = false;
  let letGo = null;
  let resizeTimer = null;
  let sparkTimer = null;
  // The waking's own state. `wokeAt` is the visitor's gesture, on the same
  // clock the frame loop hands in, so the focus and the lids are measured from
  // one origin and not from two.
  let wokeAt = 0;
  // The visitor's own gesture, which is where the BIRTH is counted from. It is
  // a birth earlier than `wokeAt` above: see enter().
  let bornAt = 0;
  // How much of the birth has been DRAWN, which is not how much time has passed:
  // see BIRTH_STEP_CAP_MS. And when the last frame of it was handed in, so that
  // a stall is measured rather than assumed.
  let borning = 0;
  let lastFrameAt = 0;
  let handedAt = 0;
  let waking = false;
  let birthTimer = null;
  let driving = false;
  let veiled = false;
  let lastPost = null;
  let awakeTimer = null;
  let lidTimer = null;

  root.appendChild(el);

  // ------------------------------------------------------------- the eyelids
  //
  // TWO SHEETS OF NIGHT, PUT ON THE PAGE NOW AND NOT AT THE GESTURE.
  //
  // They live UNDER the scene — the scene is at 31 and these are at 30 — so
  // while the sky is up they are simply not visible, and when it dissolves what
  // is behind it is a pair of shut eyes rather than a world. Made here, at
  // mount, because the gesture is the one moment in this whole arrival that
  // must not pay for a layout: at the click there is nothing to create, nothing
  // to measure and no layer to promote, only a class.
  //
  // Their inner edges are arcs and they are soft, and the four numbers that say
  // how — LID_VH, LID_SOLID_VH, LID_ARC_VH, LID_FEATHER_VH — hold two things up
  // between them: SHUT IS OPAQUE, because twice the solid depth clears the
  // frame and each soft edge falls on the other lid's solid rather than on the
  // world, and OPEN IS OPEN, because the throw is a lid's whole height and not
  // its opaque part. The note over those four is where they are argued.
  //
  // A visitor who asked for no motion gets neither these nor the focus: a blur
  // that pumps three times is exactly what the setting exists to spare them.
  /** WHERE THE EYES ARE, and they are the picture's and not the glass's.
   *
   *  «L'occhio si apre lungo tutto lo schermo e non solo nella finestra di
   *  esplorazione, questa cosa stona» (E-DECISIONI35, point 2). src/main.js
   *  measures the picture — src/core/inquadratura.js decides how big it is and
   *  src/core/cornice.js what its edge is made of — and hands it here. The box
   *  the lids live in becomes that rectangle, with its corner, so the night
   *  around the world is never covered by a lid and never blinks.
   *
   *  Without one the box is the window, which is what it always was and what a
   *  picture at the whole window with no frame on it still is. */
  function layoutLids() {
    if (!lids) return;
    const box = typeof quadro === 'function' ? quadro() : null;
    if (!box || !box.framed) {
      lids.style.left = '0px';
      lids.style.top = '0px';
      lids.style.width = '';
      lids.style.height = '';
      lidShape(grown(borning));
      return;
    }
    lids.style.left = `${box.left}px`;
    lids.style.top = `${box.top}px`;
    lids.style.width = `${box.width}px`;
    lids.style.height = `${box.height}px`;
    lidShape(grown(borning));
  }

  /** AND THE EYES ARE THE SHAPE THE PICTURE HAS SO FAR, NOT THE SHAPE IT WILL
   *  HAVE, and this is the line the first build got wrong.
   *
   *  A pair of lids on the picture's whole rectangle is a BLACK RECTANGLE, and
   *  the night behind it is not the same black: measured on the plate, the lid
   *  is #02060c and the night #050b13, so the moment the opening scene begins
   *  to dissolve the visitor sees the finished shape of the picture standing
   *  there — which is exactly the «comparira' la forma della finestra
   *  esplorabile all'improvviso» the growth exists to do away with, arriving
   *  three quarters of a second before the growth has finished.
   *
   *  So the lids are clipped to the SAME three interpolations the mask and the
   *  ring are drawn from. One shape, three places, and the two that are DOM
   *  read it from here.
   *
   *  A CLIP AND NOT A BOX. Moving the lids' own left/top/width/height per frame
   *  would relayout them and repaint two radial gradients the size of the
   *  picture on every frame of the birth; `clip-path` is a paint-time property
   *  of a layer that is already rasterised, so what changes per frame is where
   *  the compositor cuts it and nothing else. The prefixed spelling is there
   *  because Safari wanted it until 13.1 and a border that silently did not
   *  clip would be the defect this whole function exists to close. */
  function lidShape(g) {
    if (!lids) return;
    const box = typeof quadro === 'function' ? quadro() : null;
    if (!box || !box.framed) {
      lids.style.clipPath = '';
      lids.style.webkitClipPath = '';
      return;
    }
    const cx = poleX + (box.left + box.width / 2 - poleX) * g;
    const cy = poleY + (box.top + box.height / 2 - poleY) * g;
    const hw = rOrbit + (box.width / 2 - rOrbit) * g;
    const hh = rOrbit + (box.height / 2 - rOrbit) * g;
    const r = Math.min(rOrbit + (box.radius - rOrbit) * g, Math.min(hw, hh));
    const px = (v) => `${Math.max(0, v).toFixed(1)}px`;
    const clip = `inset(${px(cy - hh - box.top)} ${px(box.left + box.width - cx - hw)} `
      + `${px(box.top + box.height - cy - hh)} ${px(cx - hw - box.left)} round ${r.toFixed(1)}px)`;
    lids.style.clipPath = clip;
    lids.style.webkitClipPath = clip;
  }

  const lids = still ? null : document.createElement('div');
  const lidSheet = still ? null : document.createElement('style');
  if (lids) {
    lids.className = 'intro-lids';
    lids.setAttribute('aria-hidden', 'true');
    lids.innerHTML = '<i class="intro-lid-up"></i><i class="intro-lid-down"></i>';
    lids.style.setProperty('--wake-span', `${WAKE.span}ms`);
    lids.style.setProperty('--wake-first', `${WAKE.first}ms`);
    lids.style.setProperty('--wake-grace', `${WAKE.grace}ms`);
    // THE ARC, SOLVED HERE AND HANDED DOWN AS AN ELLIPSE.
    //
    // The sheet holds what a lid IS — black, soft-edged, moving only by a
    // translation. What SHAPE it is comes from the four numbers at the top of
    // this file, and they are four because they are readable: how far down the
    // middle it is opaque, how much deeper at the sides, how far it takes to
    // vanish, how tall it is. An ellipse is none of those things, so it is
    // worked out from them rather than written down beside them and left to
    // drift.
    //
    // The gradient is transparent INSIDE the ellipse and opaque outside it, with
    // the ellipse centred below the lid: both of its arcs — the one where the
    // opacity is still full and the one where it has gone — then bulge upward at
    // the middle of the frame, which is a lid that hangs lower at the corners.
    // That is the way round an eye actually is, and it is the opposite of the
    // first attempt.
    const solid = LID_SOLID_VH / LID_VH;
    const drop = LID_ARC_VH / LID_VH;
    const clear = LID_FEATHER_VH / LID_VH;
    // Vertical radius = the lid's own height, which leaves the horizontal one
    // to carry the arc: a wider ellipse is a flatter lid.
    const rx = 0.5 / Math.sqrt(1 - (1 - drop) ** 2);
    lids.style.setProperty('--lid-h', `${LID_VH}%`);
    lids.style.setProperty('--lid-rx', `${(rx * 100).toFixed(3)}%`);
    lids.style.setProperty('--lid-top', `${((solid + 1) * 100).toFixed(3)}%`);
    lids.style.setProperty('--lid-bottom', `${((-solid) * 100).toFixed(3)}%`);
    lids.style.setProperty('--lid-stop', `${((1 - clear) * 100).toFixed(3)}%`);
    lidSheet.textContent = lidKeyframes();
    document.head.appendChild(lidSheet);
    root.appendChild(lids);
    layoutLids();
  }

  // ------------------------------------------------------------ the birth
  //
  // THE ONE THING IN THIS SCENE THAT IS PAINTED PER FRAME ON PURPOSE.
  //
  // Everything else that moves in here moves on the compositor, because during
  // the LOAD the main thread disappears for seconds at a time. This does not,
  // and the reason is the opposite of the usual one: what it has to stay in
  // step with is the MASK IN THE COMPOSITE (src/core/cornice.js), which is a
  // uniform written from the frame loop. A border animated on the compositor
  // would keep perfect time with the clock and no time at all with the picture
  // it is the border of — and the one frame where they disagreed would be a
  // world coming out of the wrong side of its own edge.
  //
  // Above the scene rather than under it (z 32 against 31): the circle is what
  // the name and the sentence dissolve INTO, so for the two hundred
  // milliseconds they overlap it has to be the thing in front.
  const bornEl = still ? null : document.createElement('canvas');
  if (bornEl) {
    bornEl.className = 'intro-born';
    bornEl.setAttribute('aria-hidden', 'true');
    root.appendChild(bornEl);
  }
  let bornScale = 1;
  let bornSized = '';

  /** The outline, at a given point of the growth, as the same three
   *  interpolations the composite's own frameDistance() makes: a rounded
   *  rectangle whose half-sides and whose corner are all one number IS the
   *  circle the star went round, so there is one shape and not two. */
  function bornPath(ctx, g, box) {
    const cx = poleX + (box.left + box.width / 2 - poleX) * g;
    const cy = poleY + (box.top + box.height / 2 - poleY) * g;
    const hw = rOrbit + (box.width / 2 - rOrbit) * g;
    const hh = rOrbit + (box.height / 2 - rOrbit) * g;
    const r = Math.min(rOrbit + (box.radius - rOrbit) * g, Math.min(hw, hh));
    // BUILT OUT OF arcTo AND NOT OUT OF roundRect, which is four years younger
    // than this browser support target and would take the whole border away on
    // the browsers that do not have it — silently, in the one second of the
    // visit that is a ceremony. Four corners and four sides, which is what
    // roundRect is anyway.
    const l = cx - hw;
    const t = cy - hh;
    const rr = cx + hw;
    const b = cy + hh;
    ctx.beginPath();
    ctx.moveTo(l + r, t);
    ctx.arcTo(rr, t, rr, b, r);
    ctx.arcTo(rr, b, l, b, r);
    ctx.arcTo(l, b, l, t, r);
    ctx.arcTo(l, t, rr, t, r);
    ctx.closePath();
  }

  /** @param {number} g   how grown, 0..1
   *  @param {number} fade how much of the border is still being drawn here */
  function paintBorn(g, fade) {
    if (!bornEl) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const key = `${w}x${h}`;
    if (key !== bornSized) {
      bornSized = key;
      bornScale = Math.min(window.devicePixelRatio || 1, 2);
      bornEl.width = Math.max(1, Math.round(w * bornScale));
      bornEl.height = Math.max(1, Math.round(h * bornScale));
      bornEl.style.width = `${w}px`;
      bornEl.style.height = `${h}px`;
    }
    const ctx = bornEl.getContext('2d');
    ctx.setTransform(bornScale, 0, 0, bornScale, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (fade <= 0) return;
    const box = typeof quadro === 'function' ? quadro() : null;
    if (!box) return;
    ctx.lineJoin = 'round';
    for (let i = 0; i < RING_COATS.length; i += 1) {
      const [width, alpha] = RING_COATS[i];
      ctx.lineWidth = width;
      ctx.strokeStyle = `rgba(${i === RING_COATS.length - 1 ? RING_LINE : RING_HALO},`
        + `${(alpha * fade).toFixed(3)})`;
      bornPath(ctx, g, box);
      ctx.stroke();
    }
  }

  // ------------------------------------------------- the sky, drawn by notte.js
  //
  // The ground of the night, the arcs over it and the glints among them are
  // drawn by src/ui/notte.js out of the geometry this file measures. The three
  // wrappers below are all that is left of them here, and they exist so that
  // the rest of this scene goes on saying paintField() and paintTrails(): what
  // moved is WHERE the loops live, not when they run.

  function paintField() {
    NOTTE_paintField(field, geom);
  }

  function paintTrails() {
    NOTTE_paintTrails(trails, geom);
  }

  // THE PHASE OF THE TURN, KEPT ACROSS A REDRAW. The animation is restarted
  // whenever the canvas is repainted, so that the new bitmap cannot inherit a
  // rotation meant for the old one; a negative delay of exactly the elapsed
  // time modulo the period puts it back at the angle it was already at, so the
  // restart is invisible. Without it, dragging a window edge sends the whole
  // sky back to noon.
  function armSpin() {
    if (still) return;
    const phase = (performance.now() - born) % SPIN_MS;
    trails.style.animation = 'none';
    void trails.offsetWidth;
    trails.style.animation = '';
    trails.style.animationDelay = `-${phase.toFixed(0)}ms`;
  }

  // -------------------------------------------------------------- the orbit
  //
  // THE TRAIL DRAWN ONCE, WHOLE, AND THEN UNCOVERED.
  //
  // The bitmap holds the entire closed circle, tail to head, and never changes.
  // What changes is how much of it is allowed to show, and that is done by
  // turning half-planes: a box with its overflow clipped, rotated by a transform
  // with a transition on it. Nothing here is a dash offset — that is a repaint
  // of the path on the main thread, every frame, which during this load means no
  // frames at all — and nothing is redrawn per frame. A reveal already in flight
  // when hub.dress stalls the thread for two seconds carries straight through
  // it, because the compositor is the one holding it.
  //
  // WHY TWO HALVES. One turning half-plane can uncover at most half a turn, so
  // a full circle needs two, each fixed to its own side and each carrying its
  // own copy of the ring: the left half is uncovered over the first half of the
  // load and then stands open while the right half is uncovered over the second.
  // The ring inside each turns backwards by exactly what its window turns, so
  // the circle stays where it is in the world while the window sweeps over it.
  //
  // Angles below are screen angles: 0 to the right, 90 down, 270 straight up.
  // Twelve o'clock is 270, and the travel is ANTICLOCKWISE — the way the sky
  // above it turns — which is the direction of DECREASING angle.

  /** Half the side of the square the ring is drawn in: the orbit, plus the
   *  room its halo needs. */
  const ringBox = () => rOrbit + ORBIT_PAD;

  /** The night-side bitmap of the whole orbit, drawn per pixel.
   *
   *  Per pixel and not as a stroked path, because what is wanted is a ramp
   *  ALONG the circle — faint at twelve o'clock where the star set out, full at
   *  its head — and no canvas or SVG stroke can carry a gradient round a bend.
   *  Stitching it out of two hundred short strokes leaves a seam at every joint
   *  where two ends blend over each other. This has no joints. */
  function paintRing() {
    const rBox = ringBox();
    const side = 2 * rBox;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.max(1, Math.round(side * dpr));
    const s = px / side;
    ringSrc.width = px;
    ringSrc.height = px;
    const ctx = ringSrc.getContext('2d');
    const image = ctx.createImageData(px, px);
    const centre = px / 2;
    const half = ORBIT_WIDTH / 2;
    const core = [232, 248, 255];
    const glow = [127, 212, 245];
    for (let y = 0; y < px; y++) {
      const dy = (y + 0.5 - centre) / s;
      for (let x = 0; x < px; x++) {
        const dx = (x + 0.5 - centre) / s;
        const off = Math.abs(Math.sqrt(dx * dx + dy * dy) - rOrbit);
        if (off > ORBIT_PAD) continue;
        // How far round the trail this pixel is, as a fraction of the whole
        // turn, counted anticlockwise from twelve o'clock.
        const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
        const t = ((((270 - deg) % 360) + 360) % 360) / 360;
        // The cyclic ramp: minimum at the tail's own end, maximum at the head,
        // and the one place the two meet is twelve o'clock — where the head is
        // when the circle closes, and where it stays, because from then on the
        // ring turns with it.
        const lit = ORBIT_TAIL_ALPHA + (ORBIT_HEAD_ALPHA - ORBIT_TAIL_ALPHA) * t;
        // The line, with its edges softened over a pixel so the circle has no
        // staircase on it, and the halo it sits in.
        const ac = lit * smoothstep(half + 0.7, half - 0.3, off);
        const ag = lit * ORBIT_GLOW_ALPHA
          * Math.exp(-(off * off) / (2 * ORBIT_GLOW_SIGMA * ORBIT_GLOW_SIGMA));
        const a = ac + ag * (1 - ac);
        if (a < 0.003) continue;
        const o = (y * px + x) * 4;
        for (let k = 0; k < 3; k++) {
          image.data[o + k] = Math.round((core[k] * ac + glow[k] * ag * (1 - ac)) / a);
        }
        image.data[o + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
    // Drawn once and copied into both halves and into the comet: the three are
    // the same picture, and computing it three times would be paying three
    // times for one bitmap.
    for (const ring of [...rings, comet]) {
      ring.width = px;
      ring.height = px;
      ring.style.width = `${side}px`;
      ring.style.height = `${side}px`;
      ring.getContext('2d').drawImage(ringSrc, 0, 0);
    }
  }

  /** How far round each of the two legs has been travelled. The left window
   *  owns the first half turn and the right the second, and every angle in the
   *  orbit — both windows, both counter-rotations and both arms — is one of
   *  these two numbers plus a constant. There is no third quantity to fall out
   *  of step with. */
  const legsOf = (p) => {
    const q = clamp01(p);
    return [-360 * Math.min(q, 0.5), -360 * Math.max(0, q - 0.5)];
  };
  let placed = 0;

  function placeOrbit(p, ms) {
    const [a, b] = legsOf(p);
    const [a0, b0] = legsOf(placed);
    placed = clamp01(p);
    // THE DURATION IS SPLIT THE WAY THE TRAVEL IS. An update that crosses the
    // half gives the left leg the share of the time that belongs to its share
    // of the distance and delays the right leg by exactly that, so at every
    // instant one of the two is moving and the other is standing where the
    // first will arrive. The gap in the committente's frame was these two
    // moving at once.
    const moved = Math.abs(a - a0) + Math.abs(b - b0);
    const first = moved > 0 ? (ms * Math.abs(a - a0)) / moved : 0;
    orbit.style.setProperty('--intro-follow-a', `${Math.round(first)}ms`);
    orbit.style.setProperty('--intro-follow-b', `${Math.round(ms - first)}ms`);
    orbit.style.setProperty('--intro-delay-b', `${Math.round(first)}ms`);
    // AND WHEN BOTH LEGS MOVE, THEY SHARE ONE CURVE CUT IN TWO — see
    // EASE_HALF_IN. A step that crosses six o'clock used to decelerate to a
    // standstill there and set off again; now the first leg hands the second
    // its speed. When only one leg moves it gets the interface's own curve
    // whole, which is what every other movement in this world uses.
    const both = Math.abs(a - a0) > 0.001 && Math.abs(b - b0) > 0.001;
    orbit.style.setProperty('--intro-ease-a', both ? EASE_HALF_IN : 'var(--ui-ease)');
    orbit.style.setProperty('--intro-ease-b', both ? EASE_HALF_OUT : 'var(--ui-ease)');
    const wipe = [90 + a, -90 + b];
    for (let i = 0; i < 2; i++) {
      wipes[i].style.transform = `rotate(${wipe[i].toFixed(3)}deg)`;
      rings[i].style.transform = `rotate(${(-wipe[i]).toFixed(3)}deg)`;
    }
    // A half that has not set out is taken off the page rather than left
    // closed: see the note above, "A HALF THAT HAS NOT SET OUT IS NOT CLOSED,
    // IT IS ABSENT". What it would show is nothing, and what it was showing was
    // a pixel of the seam.
    halves[0].classList.toggle('is-idle', a === 0);
    halves[1].classList.toggle('is-idle', b === 0);
    arm.style.transform = `rotate(${a.toFixed(3)}deg)`;
    swing.style.transform = `rotate(${b.toFixed(3)}deg)`;
  }

  function layoutOrbit() {
    const rBox = ringBox();
    orbit.style.left = `${poleX}px`;
    orbit.style.top = `${poleY}px`;

    const outer = 2 * rOrbit + ORBIT_TRACK_WIDTH;
    track.style.width = `${outer}px`;
    track.style.height = `${outer}px`;
    track.style.left = `${-outer / 2}px`;
    track.style.top = `${-outer / 2}px`;
    track.style.borderWidth = `${ORBIT_TRACK_WIDTH}px`;

    // The left half of the plane, then the right; each holds a window that
    // covers the half-plane ABOVE the pole and turns about it.
    for (let i = 0; i < 2; i++) {
      halves[i].style.left = `${i === 0 ? -rBox : 0}px`;
      halves[i].style.top = `${-rBox}px`;
      halves[i].style.width = `${rBox}px`;
      halves[i].style.height = `${2 * rBox}px`;
      wipes[i].style.left = `${i === 0 ? 0 : -rBox}px`;
      wipes[i].style.top = '0px';
      wipes[i].style.width = `${2 * rBox}px`;
      wipes[i].style.height = `${rBox}px`;
    }

    // The comet: the same square, centred on the pole, and nothing clipping it.
    comet.style.left = `${-rBox}px`;
    comet.style.top = `${-rBox}px`;

    head.style.width = `${ORBIT_HEAD_PX}px`;
    head.style.height = `${ORBIT_HEAD_PX}px`;
    head.style.left = `${-ORBIT_HEAD_PX / 2}px`;
    head.style.top = `${-rOrbit - ORBIT_HEAD_PX / 2}px`;

    paintRing();

    // Put back where it is now, WITHOUT a transition: a window dragged wider
    // must not make the star re-run the orbit it already ran.
    orbit.classList.add('is-placing');
    placeOrbit(shown, 0);
    void orbit.offsetWidth;
    orbit.classList.remove('is-placing');
  }

  // -------------------------------------------------------------- the glints
  //
  // Declared non-critical, and the declaration is the point: this is the one
  // layer that runs on the main thread, so it is the one layer that stops when
  // the thread stops. Twenty-six points cannot be missed for a second and a
  // half; a bar or a sky that stopped would be the scene breaking.
  let glints = [];
  function seedGlints() {
    glints = NOTTE_seedGlints(spark, geom);
  }

  function twinkle() {
    NOTTE_twinkle(spark, glints);
  }

  /** How far the type has to move for its INK to sit on the pole.
   *
   *  Positive means down. Everything here is read off the page as it is right
   *  now — this face, this size, this sentence — so it is right in the fallback
   *  face and right again when the real one lands and the layout is taken
   *  again. */
  const scratch = document.createElement('canvas').getContext('2d');

  /** Where the browser put the baseline of a line — ASKED, not derived.
   *
   *  Half-leading can be computed from the font's own ascent and descent, and
   *  the first version of this did: it came out 1.15 px high at 2.6rem, because
   *  the metrics a browser lays out with and the metrics it reports are not
   *  quite the same numbers. An empty inline-block on the baseline has no such
   *  argument — the browser puts its bottom edge exactly there because that is
   *  what vertical-align: baseline means, and it is measured with the same rect
   *  as everything else. */
  function baselineOf(node) {
    const probe = document.createElement('i');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    node.appendChild(probe);
    const y = probe.getBoundingClientRect().top;
    probe.remove();
    return y;
  }

  /** And how far the INK of a line reaches above and below that baseline: the
   *  real outline extents of these glyphs in the face the browser ended up
   *  using, which is what measureText is for. */
  function inkOf(node, text) {
    const cs = getComputedStyle(node);
    scratch.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = scratch.measureText(cs.textTransform === 'uppercase' ? text.toUpperCase() : text);
    const base = baselineOf(node);
    return { top: base - m.actualBoundingBoxAscent, bottom: base + m.actualBoundingBoxDescent };
  }

  function opticalShift() {
    try {
      const title = el.querySelector('h1');
      const top = inkOf(title, title.textContent).top;
      // BOTH sentences, so that the block does not move a pixel when one
      // dissolves into the other: the lower of the two descenders is the floor
      // of the type from the first frame to the last.
      const bottom = Math.max(
        inkOf(words[0], WAITING).bottom,
        inkOf(words[1], READY).bottom,
      );
      const boxed = block.getBoundingClientRect();
      return (boxed.top + boxed.height / 2) - (top + bottom) / 2;
    } catch {
      // A browser without the ink metrics gets the boxes centred, which is
      // where this began and is not wrong, only unrefined.
      return 0;
    }
  }

  // --------------------------------------------------------------- the whole

  /** Where everything is, for the frame the browser has right now.
   *
   *  Separated from the drawing because it is cheap and the drawing is not:
   *  this runs whenever anything might have moved, and what it returns is the
   *  answer to the only question the sky ever asks — has anything changed that
   *  the sky was drawn for.
   *
   *  The quiet radius in that answer is QUANTISED, and deliberately. The web
   *  font lands in the middle of this load — it is on the wire behind four
   *  megabytes of texture — and when it does, FARFIELD gets its real width and
   *  every radius here moves by a few pixels. Repainting a sky of half a
   *  million pixels for that is a crossfade the visitor sees at two and a half
   *  seconds, for a change to the quiet gate that is a smoothstep over hundreds
   *  of pixels and cannot show it. So the sky is asked to notice sixteen pixels
   *  and not one. */
  let skyKey = '';
  function measure() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    poleX = Math.round(w / 2);
    poleY = Math.round(h * POLE_Y);
    // The furthest corner from the pole, whichever it is: on a tall window that
    // is the bottom one, on a short one it can be the top.
    rOut = Math.hypot(Math.max(poleX, w - poleX), Math.max(poleY, h - poleY));

    block.style.left = `${poleX}px`;
    block.style.top = `${poleY}px`;
    block.style.marginTop = '0px';
    // THE POLE TAKES THE OPTICAL MIDDLE OF THE TYPE, NOT THE MIDDLE OF ITS BOX.
    //
    // A line box is not the ink in it. FARFIELD is uppercase with no descender,
    // so the box carries air under it that no letter uses, and the sentence
    // below has descenders that reach further than its box middle suggests.
    // Centring the boxes on the pole therefore leaves the type sitting low, and
    // the circle round it with more air above than below — measured 9 px of
    // difference before this, on a 1600x900 frame.
    //
    // So the ink is asked where it actually is. measureText gives the REAL
    // extents of these glyphs in this face at this size, and the half-leading
    // rule gives where the baseline falls in a line box: together they are the
    // top of the F and the bottom of the g, to the pixel, at runtime, in
    // whatever face the browser ended up using.
    const shift = Math.round(opticalShift());
    block.style.marginTop = `${shift}px`;
    const box = block.getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

    // BOTH RADII ARE MEASURED, not guessed. The half-diagonal of the block the
    // browser actually laid out — this font, this size, both sentences stacked,
    // this language — is what the orbit has to clear, and the orbit in turn is
    // what the quiet has to clear. So the star's circle is round the name by
    // construction and inside the empty sky by construction, and the floor of
    // three tenths of the shorter side keeps the quiet a proportion of the
    // frame on a window nobody designed for.
    // The corner of the block that is FURTHEST from the pole, which after the
    // optical shift is no longer simply the half-diagonal: the block is off
    // centre by a few pixels and the circle has to clear the side it moved
    // towards.
    const halfDiagonal = Math.hypot(box.width / 2, box.height / 2 + Math.abs(shift));
    rOrbit = halfDiagonal + ORBIT_MARGIN_REM * rem;
    rQuiet = Math.max(0.30 * Math.min(w, h), rOrbit + ORBIT_PAD + 2 * rem);

    // AND THE SAME SIX NUMBERS, GATHERED, because that is the whole interface
    // between this scene and the sky it is drawn on. src/ui/notte.js takes
    // these and nothing else: it never reads the window, never measures the
    // block, and therefore cannot disagree with the five lines above about
    // where the pole is.
    geom = {
      width: w, height: h, poleX, poleY, rOut, rQuiet,
    };

    return `${w}x${h}|${Math.round(rQuiet / 16)}`;
  }

  function layout() {
    const key = measure();
    if (key !== skyKey) {
      skyKey = key;
      paintField();
      paintTrails();
      armSpin();
      seedGlints();
      if (sparkTimer) twinkle();
    }
    layoutOrbit();
  }

  function paint() {
    let sum = 0;
    let all = true;
    for (const phase of Object.keys(WEIGHTS)) {
      const fraction = clamp01(bus.fractions[phase] || 0);
      sum += fraction * WEIGHTS[phase];
      if (fraction < 1) all = false;
    }
    target = all ? sum + CLOSE : sum;
    if (target <= shown) return;
    shown = target;
    if (held) return;
    chase();
  }

  /** The step in hand is over: the next one may be taken, and if there is no
   *  next one then the star has arrived and the scene may say so.
   *
   *  THIS IS THE ONLY PLACE THE CIRCLE IS EVER DECLARED CLOSED. chase() first,
   *  because a report that landed mid-step is owed a step and the arrival is
   *  not a fact while one is owed; land() second, and it refuses unless that
   *  call left the queue empty with the angle at a whole turn. */
  function endStep() {
    if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }
    if (!stepping) return;
    stepping = false;
    stepLegs = 0;
    chase();
    land();
  }

  function chase() {
    // THE CHASE, AND WHY NOTHING INTERRUPTS ANYTHING.
    //
    // A STEP IN HAND IS FINISHED FIRST. Every report used to restart the
    // transition, and --ui-ease sets off from a standstill, so a burst of
    // reports the visitor could not see became a stutter they could: measured
    // off the glass, 111, 409, 97, 137, 45, 74, 7, 15 degrees a second inside
    // four hundred milliseconds. Now a report that lands mid-step is simply
    // accumulated — `shown` is already up to date — and collected when the step
    // ends. Consecutive steps join where --ui-ease leaves and arrives, which is
    // at rest, so the speed is continuous from one end of the load to the other.
    if (stepping) return;

    // AND THE LAST TENTH OF THE CIRCLE BELONGS TO THE CLOSE. Until the ledger
    // is a fact the star may not spend it — see ORBIT_CLOSE_ARC. This is not a
    // guess at the hundred and it never moves for one; it is a brink the chase
    // stops at, so that when the fact arrives there is one whole glide left to
    // make instead of a handful of tics.
    const closing = shown >= 1;
    const goal = closing ? 1 : Math.min(shown, 1 - ORBIT_CLOSE_ARC);
    const distance = goal - placed;
    if (distance <= 0) return;

    // AND A TWITCH WAITS FOR COMPANY. The tail of the ledger is a drizzle —
    // six engrave ticks a fortieth of a turn each — and every one of those
    // taken on its own is a movement that starts from rest and dies back to it
    // inside what the eye reads as a single approach. Held, they arrive as one
    // step. The wait is bounded, so a ledger that goes quiet cannot leave the
    // star standing on a technicality.
    if (!closing && !waitDue && distance < ORBIT_STEP_MIN) {
      if (!waitTimer) {
        waitTimer = setTimeout(() => {
          waitTimer = null;
          waitDue = true;
          chase();
        }, ORBIT_STEP_WAIT_MS);
      }
      return;
    }
    if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
    waitDue = false;

    // AND A STEP'S LENGTH IS ITS DISTANCE. Half the critical load lands in ONE
    // report — terrain-albedo is 74% of it and arrives whole — so a star given
    // a fixed time would snap round three quarters of the circle. At a pace,
    // that same report is the longest, slowest sweep of the whole arrival,
    // which is what it should be: it is the longest wait.
    const left = Math.max(0, born + BREATH_MS - performance.now());
    let ms = Math.min(FOLLOW_MAX_MS, Math.max(FOLLOW_MIN_MS, distance * ORBIT_PACE_MS));
    // The closing glide is the one movement the visitor is actually waiting
    // for: it gets its own floor, and it may not land before the breath is out.
    if (closing) ms = Math.max(ms, ORBIT_CLOSE_MS, left);
    if (still) ms = FOLLOW_STILL_MS;
    // Which of the two legs this step actually moves, taken BEFORE the step is
    // laid in: they are what the end of it will be waited for.
    const [na, nb] = legsOf(goal);
    const [oa, ob] = legsOf(placed);
    placeOrbit(goal, ms);

    // AND THE STEP ENDS WHEN THE PICTURE SAYS SO, NOT WHEN A TIMER DOES.
    //
    // This was got wrong first and orbita.mjs found it: a step of 1200 ms was
    // being followed by the next one while the previous transition was still in
    // flight, and the two legs of the reveal — which must never move at once —
    // both moved for a second and three quarters. Measured on the computed
    // transforms themselves (bracci.mjs), the second leg's sheet read
    // `duration 1.2s, delay 0s` while the first was still coming down from 94
    // to 179 degrees.
    //
    // The cause is that a transition starts when the STYLE IS APPLIED and a
    // setTimeout counts from when it was ASKED FOR, and during this arrival
    // those are not the same instant: the style change waits for the next
    // recalculation, which waits for a main thread that is decoding textures.
    // So the step is ended by the transitionend of the legs that actually moved
    // — the picture's own clock — and the timer stays behind it, with a
    // generous slack, for the one case an end never arrives at all: a tab sent
    // to the background, or a relayout that cancelled the transition outright.
    stepping = true;
    stepLegs = (Math.abs(na - oa) > 0.001 ? 1 : 0) + (Math.abs(nb - ob) > 0.001 ? 1 : 0);
    // AND THE RESERVE, for the one case a transitionend never arrives at all: a
    // tab sent to the background, or a relayout that cancelled the transition
    // outright. It is deliberately BEHIND the real landing rather than level
    // with it — a transition starts when the style is APPLIED and this timer
    // counts from when it was ASKED FOR, and during this arrival those are not
    // the same instant (INTRO-D measured a second leg setting off while the
    // first was still coming down from 94 to 179 degrees). A reserve that could
    // fire before the picture had landed would be the very fault this whole
    // unit is here to remove, arriving by a different door.
    if (stepTimer) clearTimeout(stepTimer);
    stepTimer = setTimeout(endStep, ms + 1500);
  }

  /** THE CIRCLE IS CLOSED, AND IT IS THE STAR THAT SAYS SO.
   *
   *  THE FAULT THE COMMITTENTE PHOTOGRAPHED WAS HERE. «Si è riempita tutta la
   *  barra, il punto iniziale è ruotato, e poi la stella lo raggiunge piano
   *  piano»: a complete ring, the sentence already at «Clicca per iniziare»,
   *  and the star still at four o'clock. What this used to ask was `target < 1`
   *  — the LEDGER's number, not the picture's — and then it was called from the
   *  transitionend of any leg of any step, and from a timer set for the end of
   *  the breath. So on any cadence that closed the ledger while a step was in
   *  flight, the first thing that finished ANYTHING declared the world ready,
   *  and the star was wherever the chase had got to. Reproduced deliberately on
   *  s2-intro/banco.mjs before a line was changed: on three cadences of five,
   *  PRONTA landed at 2718 ms with the head at 50% of the turn.
   *
   *  And what PRONTA does made it look far worse than a star merely being
   *  early. `is-ready` fades in the comet — which is the WHOLE ring, unclipped
   *  — so the circle completes itself in four hundred milliseconds however far
   *  round the star has been; it starts the comet turning, so the seam leaves
   *  twelve o'clock; and it puts the idle animation on the outer arm, whose
   *  first keyframe is a flat rotate(-180deg), so a star that had not reached
   *  six o'clock SNAPS there and then creeps on. Every one of the three things
   *  in that photograph is this one call, made too early.
   *
   *  So the gate is the PICTURE and nothing that stands for it: the one angle
   *  must be home (`placed` at a whole turn, which only the closing step sets)
   *  and the queue must be empty (`stepping` false, which only the transitionend
   *  of the legs that actually moved — or the reserve behind them — clears).
   *  There is exactly one caller, endStep, and one re-arm, for the breath. */
  function land() {
    if (arrived || state !== 'carico') return;
    if (target < 1 || placed < 1 || stepping) return;
    const left = born + BREATH_MS - performance.now();
    if (left > 0) {
      if (landTimer) clearTimeout(landTimer);
      landTimer = setTimeout(land, left + 16);
      return;
    }
    arrived = true;
    state = 'pronta';
    // The sentence changes by dissolving through the other one, not by being
    // replaced: both are in the same grid cell, both cross at the interface's
    // own length, and the block never reflows because it was laid out around
    // the taller of the two from the first frame.
    words[0].classList.remove('is-on');
    words[1].classList.add('is-on');
    // AND THE WAIT IS ALIVE, IN TWO PLACES. The star does not stop when its
    // circle closes — it goes on round the trail it has drawn, slowly — and the
    // sentence breathes. Both are compositor animations put on by this one
    // class, both begin where what came before them left off, and both are
    // carried away by the same dissolve as everything else at the gesture.
    el.classList.add('is-ready');
  }

  function stopGlints() {
    if (sparkTimer) { clearInterval(sparkTimer); sparkTimer = null; }
  }

  function dispose() {
    // THE FRAME GOES BACK TO EXACTLY WHAT IT WAS, whatever happened. If the tab
    // spent the waking in the background the loop never ran, the drive never
    // reached its last step, and a world left half blurred by a scene that no
    // longer exists is the worst failure this file could have. Nought and one,
    // written from here, and after this line the guarded branches in the
    // composite are not taken by anybody.
    driving = false;
    lastPost?.setWake(0, 1);
    // AND THE FRAME IS PUT BACK THE SAME WAY, for the same reason: a picture
    // left half born by a scene that no longer exists is a world nobody can
    // walk into. Grown, no cyan, all of it there.
    lastPost?.setNascita(1, 0, 1);
    if (birthTimer) { clearTimeout(birthTimer); birthTimer = null; }
    if (awakeTimer) { clearTimeout(awakeTimer); awakeTimer = null; }
    if (lidTimer) { clearTimeout(lidTimer); lidTimer = null; }
    if (letGo) { clearTimeout(letGo); letGo = null; }
    if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }
    if (landTimer) { clearTimeout(landTimer); landTimer = null; }
    if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
    if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null; }
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (swapTimer) { clearTimeout(swapTimer); swapTimer = null; }
    if (typeTimer) { clearTimeout(typeTimer); typeTimer = null; }
    stopGlints();
    if (bus.sink === paint) bus.sink = null;
    el.removeEventListener('click', onClick);
    for (const w of wipes) {
      w.removeEventListener('transitionend', onWiped);
      w.removeEventListener('transitioncancel', onWiped);
    }
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', onResize);
    // Thirty-one megabytes of backing store, given back rather than left for
    // the collector to find: this is the moment the world needs every one of
    // them, and a canvas is only freed when its width is set to nothing.
    for (const c of [field, trails, spark, ringSrc, comet, ...rings]) { c.width = 0; c.height = 0; }
    if (bornEl) { bornEl.width = 0; bornEl.height = 0; bornEl.remove(); }
    el.remove();
    lids?.remove();
    lidSheet?.remove();
    cover?.remove();
  }

  /** The arrival veil is handed its cue, once. It is a witness and not a
   *  command: everything after this — the hold, the long dissolve, the first
   *  step that cuts it short — is the arrival this world already had. */
  function raise() {
    if (veiled) return;
    veiled = true;
    onAwake?.();
  }

  function finish() {
    if (state === 'finita') return;
    state = 'finita';
    raise();
    dispose();
  }

  function enter() {
    if (state !== 'pronta') return;
    state = 'risveglio';
    // THE ORIGIN OF THE WHOLE WAKING, AND IT IS A BIRTH AHEAD OF THE GESTURE.
    //
    // «PRIMA il cerchio cresce, POI l'occhio si apre dentro» (E-DECISIONI35,
    // point 4). The timeline above is not touched by a millisecond: what
    // changes is where its zero is. Between the gesture and that zero the
    // circle grows, the tables hold at their first row — the eyes shut, the
    // blur whole, the light too bright — and nothing else in this file knows
    // the difference.
    bornAt = performance.now();
    lastFrameAt = bornAt;
    // A PLACEHOLDER AND NOT A DECISION: drive() writes the real one on the
    // frame the border lands. This is what the waking is measured from if no
    // frame is ever drawn at all — a tab that spent the whole birth in the
    // background — and on that page nothing is being looked at anyway.
    wokeAt = bornAt + (still ? 0 : BIRTH_MS);
    if (still) borning = 1;
    // The glints go first: nothing that runs on the main thread should still be
    // running while the world takes its first frames.
    stopGlints();
    // AND THE ONLY NUMBER THAT LEAVES THIS FILE. The way in engages the walker
    // and asks for the pointer; the hearing opens muffled and sweeps itself
    // clear over exactly this long, on its own clock. Nothing comes back.
    onGesture?.(still ? REDUCED_WAKE_MS : WAKE.total);
    // THE SKY IS NOT STOPPED. It fades while it turns, which is the difference
    // between a scene letting go and a scene being switched off.
    el.classList.add('is-going');

    if (still) {
      // One crossfade and the world, with the arrival veil starting at once:
      // for a visitor who asked for no motion the waking is the fade and
      // nothing else.
      raise();
      letGo = setTimeout(finish, fadeMs);
      return;
    }

    // AND THE LIDS ARE NOT STARTED HERE ANY MORE. They used to be: one class,
    // and the compositor ran the whole animation from its own delay. Now there
    // is a birth in front of them, and the birth is drawn on the frame loop —
    // so a lid whose delay ran on the compositor's clock would open on time
    // through a stall that had left the border half grown. drive() adds the
    // class on the frame the growth finishes, and from that instant the
    // animation is exactly the compositor's own, with exactly the delay and the
    // curves it was designed with.
    driving = true;
    // The veil's cue is given by the FRAME LOOP and not by this timer — see
    // drive() — because a setTimeout during this arrival arrives when the main
    // thread comes back and not when it was asked to: measured, this one landed
    // at 3995 ms against the 3250 it was set for, and the arrival composition
    // began three quarters of a second after the eyes had finished opening.
    // What is left of it here is the case the loop cannot cover: a tab that
    // spent the waking in the background, where no frame is drawn at all.
    //
    // ALL THREE ARE A BIRTH LATER THAN THEY WERE, for the same reason the
    // waking's own zero is: they are counted from the gesture and the waking no
    // longer begins at it.
    const after = still ? 0 : BIRTH_MS + BIRTH_SLACK_MS;
    // AND THE CEILING UNDER THE BIRTH'S OWN PROMISE. The growth advances by
    // frames, so a tab that spent it in the background never finishes it and
    // the eyes would never begin. This is the one thing in here that ends the
    // birth on a CLOCK, and the slack over it is longer than the worst stall
    // measured on the reference machine — on a page that is drawing at all,
    // drive() has always already finished first and this finds nothing to do.
    birthTimer = setTimeout(() => {
      birthTimer = null;
      if (borning < 1) {
        borning = 1;
        wokeAt = performance.now();
        handedAt = wokeAt;
      }
      if (waking || !lids) return;
      waking = true;
      lids.classList.add('is-waking');
    }, after);
    awakeTimer = setTimeout(raise, after + WAKE.veil + 400);
    // Belt and braces of a different kind: at this point the lids are off the
    // top and the bottom of the frame anyway, and this is what covers a browser
    // that landed the animation a hair short of its last keyframe.
    lidTimer = setTimeout(() => lids.classList.add('is-gone'), after + WAKE.total);
    letGo = setTimeout(finish, after + WAKE.total + WAKE.grace);
  }

  /**
   * THE FOCUS, one line in the frame loop, and it turns itself off.
   *
   * It is here rather than on a timer of its own because a blur is a property
   * of a FRAME: a setInterval writing uniforms between two frames writes them
   * twice for nothing, and one that fires during a stall writes them for a
   * frame that will never be drawn. Given the loop's own clock — the same
   * origin `wokeAt` was taken on — every frame gets the blur that belongs to
   * the instant it is being drawn for, however far apart two of them are.
   *
   * @param {object} post   renderer.post
   * @param {number} nowMs  the frame's timestamp, on performance.now()'s clock
   */
  function drive(post, nowMs) {
    if (!driving) return;
    if (!post || typeof post.setWake !== 'function') { driving = false; return; }
    lastPost = post;
    const now = typeof nowMs === 'number' ? nowMs : performance.now();

      // ------------------------------------------------------------ the birth
    //
    // The circle of the loading, growing into the picture. Two things move and
    // they are the same three numbers: the mask in the composite, which is what
    // the world is allowed to be, and the ring on the canvas above the lids,
    // which is what the visitor is looking at. Written from HERE and not from
    // two places, on the frame's own timestamp, so they cannot come apart.
    if (bornEl) {
      const step = Math.min(BIRTH_STEP_CAP_MS, Math.max(0, now - lastFrameAt));
      lastFrameAt = now;
      if (borning < 1) {
        // Advanced by the time that really passed, capped: see the note over
        // BIRTH_STEP_CAP_MS. A stall makes the birth longer and never makes it
        // jump.
        borning = Math.min(1, borning + step / BIRTH_MS);
        const box = typeof quadro === 'function' ? quadro() : null;
        if (box && box.framed) {
          // Where the circle stands, in the picture's own pixels, measured from
          // the middle of the picture with y pointing UP — which is the uv the
          // composite works in and not the page's.
          post.setSeme(
            poleX - (box.left + box.width / 2),
            (box.top + box.height / 2) - poleY,
            rOrbit,
          );
        }
        post.setNascita(grown(borning), 1, 1);
        paintBorn(grown(borning), 1);
        lidShape(grown(borning));
        if (borning < 1) return;
        // LANDED, AND THIS IS WHERE THE WAKING'S ZERO IS. Not a birth after the
        // gesture — a birth after however long the birth actually took, which
        // is the whole point of the speed limit above.
        wokeAt = now;
        handedAt = now;
      }
      if (bornSized !== '') {
        // The handover: the drawn ring goes out while the halo in the composite
        // — cyan for exactly as long as this lasts, and the picture's own light
        // afterwards — comes up under it. One subtraction, two borders, no gap.
        const hand = Math.min(1, Math.max(0, (now - handedAt) / BIRTH_HANDOVER_MS));
        post.setNascita(1, 1 - hand, 1);
        paintBorn(1, 1 - hand);
        if (hand >= 1) {
          // Thirty-odd megabytes of window-sized backing store, given back now
          // rather than when the collector next looks.
          bornSized = '';
          bornEl.width = 0;
          bornEl.height = 0;
          bornEl.remove();
        }
      }
    }

    // AND THE EYES BEGIN ON THE FRAME THE BORDER LANDED ON. One class, once,
    // and from here the lids are the compositor's exactly as they were.
    if (!waking && lids) {
      waking = true;
      lids.classList.add('is-waking');
    }

    const t = now - wokeAt;
    if (t >= WAKE.veil) {
      // Exactly nought and exactly one, written once and then never again. Not
      // "small enough": the branches these guard in the composite have to stop
      // being taken, or the world would carry a hundredth of a blur for the
      // rest of the visit and every frame would pay for the buffer under it.
      driving = false;
      post.setWake(0, 1);
      // AND THE VEIL IS CUED FROM HERE, on the frame the eyes finish opening
      // on, because this is the only clock in the scene that keeps time with
      // the picture. The timer that used to do it is a setTimeout during the
      // heaviest part of an arrival, and a setTimeout arrives when the main
      // thread comes back rather than when it was asked to: measured, it landed
      // at 3995 ms against the 3250 it was set for, and the arrival composition
      // began three quarters of a second after the waking had ended.
      raise();
      return;
    }
    post.setWake(rampAt(WAKE_BLUR, t), rampAt(WAKE_EXPOSURE, t));
  }

  const onClick = () => enter();
  const onKeyDown = (event) => {
    if (state === 'risveglio' || state === 'finita') return;
    // Nothing behind this hears a key while it is up. Window capture, so it is
    // taken before the document listeners the world walks by ever see it.
    event.stopPropagation();
    if (state === 'pronta' && isEntry(event)) enter();
  };
  const onWiped = (event) => {
    if (event.propertyName !== 'transform') return;
    // AND IT IS THE WINDOW'S OWN END, NOT ITS CHILD'S. transitionend BUBBLES,
    // and the ring canvas that counter-rotates inside each window is a child of
    // it with a transition of its own on the same property and the same length.
    // So every leg was announcing itself TWICE, and a step that crossed six
    // o'clock — two legs, so two ends waited for — had both of them accounted
    // for by the first leg alone: the step was declared over at the halfway
    // mark, with the second leg not yet set off. That is how PRONTA came to
    // land at exactly half a turn on the bench, and before that it is how a
    // following step could set off while the second leg was still in flight —
    // the one thing the whole two-legged construction exists to forbid, still
    // happening after INTRO-D had cured it, because bracci.mjs only ever caught
    // the case where a step was waiting behind.
    if (event.target !== event.currentTarget) return;
    // One leg of the step in hand has finished. When the last of them has, the
    // step is over and the next may be taken — this and not the timer is what
    // keeps the two legs of the reveal from ever moving at once, because it is
    // the picture's own clock and a timer is not.
    //
    // AND IT DOES NOT DECIDE ANYTHING ELSE. This used to call land() as well,
    // on every leg of every step, which is how a step that merely CROSSED six
    // o'clock came to declare the world ready — see land(). The end of a leg is
    // the end of a leg; whether the circle is closed is a question about the
    // whole angle and it is asked in one place.
    //
    // A cancel counts as an end: a relayout can take a transition away
    // mid-flight, and when it does the element is already standing at the value
    // it was travelling to, which is the only thing the step was waiting for.
    if (stepping && stepLegs > 0) {
      stepLegs--;
      if (stepLegs === 0) endStep();
    }
  };
  /** Lay the scene out again for a frame that is not the one it was drawn for.
   *
   *  A canvas repainted at full strength is the same pop the entrance exists to
   *  do away with, so the two big ones go out first, are redrawn while they are
   *  not there, and come back. During the entrance itself they are already on
   *  their way up from nothing and the repaint cannot be seen, so it is simply
   *  done. */
  function relayout() {
    // The eyes go where the picture went, and they go there FIRST: the picture
    // can change shape without the window moving at all — the bench answers at
    // the end of the load and the page resizes itself once, behind this very
    // scene — and a pair of lids left on the old rectangle would open on a
    // border of night.
    layoutLids();
    if (swapTimer) { clearTimeout(swapTimer); swapTimer = null; }
    // Nothing the sky was drawn for has moved: put the name and the circle
    // where they now belong and leave the half million pixels alone.
    if (measure() === skyKey) { layoutOrbit(); return; }
    // During the entrance the sky is still on its way up from nothing and a
    // repaint cannot be seen, so it is simply done.
    if (performance.now() - born < entranceMs) { layout(); return; }
    el.classList.add('is-swapping');
    swapTimer = setTimeout(() => {
      swapTimer = null;
      layout();
      el.classList.remove('is-swapping');
    }, swapMs);
  }

  const onResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    // Debounced, because a drag of the window edge is a hundred resize events
    // and each one of these is a repaint of a million pixels.
    resizeTimer = setTimeout(() => { resizeTimer = null; relayout(); }, RESIZE_MS);
  };

  el.addEventListener('click', onClick);
  for (const w of wipes) {
    w.addEventListener('transitionend', onWiped);
    w.addEventListener('transitioncancel', onWiped);
  }
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onResize);

  layout();
  // The block is measured before the web font has necessarily landed, and the
  // font is what decides how wide FARFIELD is. One more pass when it arrives,
  // free on a warm cache and correct on a cold one.
  document.fonts?.ready.then(() => { if (state === 'carico' || state === 'pronta') relayout(); });

  if (!still) sparkTimer = setInterval(twinkle, SPARK_MS);

  // THE COVER IS ADOPTED, NOT SWITCHED FOR. It is the same night this is
  // painted on, and the two are only ever one picture: the sheet is taken off
  // after this element is on the page, drawn and laid out, so the frame that
  // loses one has already gained the other. The layout is forced by reading a
  // property rather than by waiting for a frame, because during this load a
  // frame can be two seconds long — measured at 2339 ms on this world — and a
  // cover lifted a frame early is the flash it was put there to prevent.
  void el.offsetWidth;
  cover?.remove();

  // AND ONLY NOW DOES ANY OF IT COME UP. Everything above put the scene on the
  // page at nothing: drawn, measured, laid out, turning, and invisible. This one
  // class starts every layer's own transition, each with the length and the
  // delay it was handed, and the flush a line above is what gives the browser
  // two states to interpolate between — the same read overlay.js makes for the
  // same reason, and for the same reason it is a read and not a wait for a
  // frame: during this load a frame can be two seconds long.
  el.classList.add('is-here');

  // ...except the type, which comes up when its own face is there. If the face
  // is already in hand this is the same instant and the schedule is the one it
  // was designed as; if it is not, the wait has already provided the stagger
  // and the two lines follow each other in from wherever the wait ended.
  let lettered = false;
  const letter = () => {
    if (lettered || state === 'finita') return;
    lettered = true;
    const late = performance.now() - born;
    const at = Math.max(0, entrance.title[1] - late);
    el.style.setProperty('--in-title-at', `${Math.round(at)}ms`);
    el.style.setProperty('--in-word-at', `${Math.round(at + entrance.word[1] - entrance.title[1])}ms`);
    el.classList.add('is-lettered');
  };
  const face = (() => {
    const cs = getComputedStyle(el.querySelector('h1'));
    return `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  })();
  if (!document.fonts || document.fonts.check(face)) letter();
  else {
    document.fonts.load(face).then(letter, letter);
    typeTimer = setTimeout(letter, TYPE_WAIT_MS);
  }

  // Whatever landed while this chunk was on the wire, and then every report
  // after it. Subscribed and then read at once, so the first thing drawn is the
  // state of the load and not a nought that was true a second ago.
  bus.sink = paint;
  paint();
  // The star sets out when its path is there and not before.
  holdTimer = setTimeout(() => {
    holdTimer = null;
    held = false;
    if (shown > 0) chase();
  }, entrance.star[1]);
  // AND THE TIMER THAT USED TO SIT HERE IS GONE, because it was one of the two
  // doors the fault came through. It read: "a world so warm it was already
  // finished before this module arrived — then no report will ever come, the
  // chase was never started, and only the breath is left to wait for". That
  // case is not real. paint() is called explicitly one line above, so a warm
  // ledger is already in `shown` before this timer is even set, and the release
  // above starts the chase for it. What the timer actually did was declare the
  // world ready at BREATH_MS + 32 whatever the star was doing — measured on the
  // bench, PRONTA at 2718 ms with the head at half a turn, on three cadences of
  // five. The breath is now waited for from inside land(), where the picture
  // can be asked about as well.

  return { drive, dispose, relayout };
}
