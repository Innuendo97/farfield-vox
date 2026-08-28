# Reference plates, into the sky

From a photograph of cloud on blue sky to a piece the runtime already knows how
to draw. Five steps, each one a command, each one leaving something a human can
look at.

The roster — `assets-src/clouds/plates.json` — carries everything the pixels
cannot answer for themselves: how much sky a frame spans, where the light was,
how many bodies a frame is supposed to hold. **It is the one file to check when
new sources land.** The chain reads it, states what it made of each plate, and
says so when a plate disagrees with its entry.

## The chain

`<work>` below is a scratch directory of the run's own choosing and is not part
of the delivery: nothing tracked here reads it, and only the four files named at
the end of this section ever leave it.

```
# 0. the roster FIRST, and for a source with its own alpha that means
#    `skyColour` (or `world.plateSky`) as well as the span: without one the
#    chain stops rather than invent an exposure. Derive it from the dome
#    instead of guessing it — see "Derive it, do not guess it" below.

# 1. metadata off. Nothing downstream will read a plate that has not been here.
node tools/clouds/ingest/sanitise.mjs <work>/sources --out <work>/clean
node tools/grade/check-png.mjs <work>/clean/*.png

# 2 and 3. the sky estimated, the cloud lifted off it, the frame cut into bodies
node tools/clouds/ingest/matte.mjs <work>/clean/*.png \
     --out <work>/pieces --preview

# 4. the atlas and the manifest the photographic field consumes
node tools/clouds/ingest/pack.mjs <work>/pieces \
     --out <work>/atlas --compose <composition.json>

# 5. what it is all worth
node tools/clouds/ingest/validate.mjs --pieces <work>/pieces \
     --atlas <work>/atlas --out <work>/validation

# 6. the same field, for the surfaces that reflect the sky instead of standing
#    in front of it. Without this the water reflects the sky before last.
node tools/clouds/ingest/reflect.mjs --atlas <work>/atlas \
     --out <work>/reflections
```

To put it in front of the eye: copy `cloud-sprites.png`, `cloud-cover.png` and
`clouds.json` from the atlas directory and `cloud-equirect.png` from the
reflection directory into `assets-src/clouds/`, run `npm run assets:build`, and
walk. The coverage travels in its own file because a block codec cannot hold a
block that is part cloud and part nothing: measured on the delivery before this
one it lifted twenty thousand texels of clear sky above nought and drew them as
squares of false cloud over open blue. `cloud-sprites.png` keeps its fourth
channel all the same, so a delivery is still one file that draws. The manifest says
`source: "plates"` and that word is what puts this field in the frame ahead of
the generated one — see `PLATE_FIELD` in `src/world/clouds.js` — so a delivery
of plate pieces is a delivery of those three files and nothing else.

## The composition is an input to the packing, not only to the runtime

`--compose` is not optional in a real delivery and not only because a sky with
no placements is a sky nobody designed. **The level of every piece is calibrated
against the sky it will stand in front of**, and the composition is where that
height is written. This dome is three times the radiance at two degrees of
elevation that it has at fifteen, and the whole of that fall happens inside the
band the weather occupies: calibrated at one height for all, the deck on the
horizon arrived three times too dark for the sky behind it — a Weber contrast of
minus 0.03 where the reference reads plus 0.22 — and no threshold called it
cloud at all. Repack when the composition moves a piece in height.

## And when the numbers argue with the plate

Every knob is in the roster and every one of them has a default that works on
all nine of the sources this was built against. In the order they are worth
touching:

- **`spanDeg`** — how wide the frame is, in degrees. It sets how large the sky
  draws every piece off that plate and it cannot be read off the pixels. Check
  it first, always.
- **`density`** — how many times its own depth a piece is drawn at. The default
  of 1.6 was written for mattes this chain ESTIMATED, which come back thin. A
  source that brings its own matte has already answered the question: leave it
  at one on the bodies, and take it UNDER one on veils, whose extended
  semi-transparent fill is the pale slab this campaign spent four units removing.
- **`skyBalance`** — how much of the background's own COLOUR a plate takes back,
  nought to one, and the default of nought is the chain before it existed. The
  level of a plate is calibrated by one scalar against the sky it was shot
  against, so a piece keeps the chromaticity of that sky whatever height it is
  then stood at. Under twenty four degrees that is harmless and measured to be —
  `cloudLevel` was fitted there. Above forty it is a sheet of cirrus lit by the
  white balance of the horizon and set against the blue of the zenith, which is
  the reading "marble" and not "ice". This gives it back the ratio the scalar
  dropped, at the stated share; half is the geometric mean of the two skies. For
  high veil and nothing else, and the manifest reports the resulting `tint` per
  piece so a delivery can prove which plates it touched.
- **`texelDeg`** — degrees of sky one texel spans, per plate, when a coarser
  rate than the atlas's own is right for it. The atlas's rate is stated where a
  piece STANDS, so the packing already divides it by the largest scale the
  composition uses; this is for material with no silhouette to lose, which is
  high cirrus and nothing else.
- **`bodies`** — how many pieces the plate should yield. Not enforced; the run
  says so when what it found differs, which is what catches the two below set
  wrong.
- **`dilateDeg`** — how far apart two lobes may be and still be one cloud.
  Raise it when one body comes out as several; lower it when two bodies the
  source separated arrive welded.
- **`coreAlpha`**, **`minBodyDeg`** — what counts as a body at all. A plate of
  thin cirrus needs the first lowered; a grainy plate needs the second raised.
- **`floor`** — the soft knee on the coverage, in multiples of the plate's own
  noise. It is a knee and never a threshold. Lower it on veil, raise it on a
  plate whose empty sky comes back with a wash on it.
- **`edgeCeiling`**, **`fadeDeg`** — what a body may still be carrying where the
  frame ran out, and how wide the band that brings it to nothing. Only a source
  whose weather leaves the picture needs either.
- **`degree`** — the order of the background surface. Two is right for a clear
  sky; three follows a stronger halo and is likelier to follow a cloud as well.

## When the source brings its own alpha

Nothing in the roster has to say so: `sanitise.mjs` asks the file. A fourth
channel of ones is dropped as it always was; a real matte is kept at eight bits,
and the step reports how much of the frame is partly covered — under two per
cent and it says so, because that is a mask and not a matte and the fringe it
draws will be a step. `matte.mjs` then does no matting at all: no surface fitted
to the background, no knee at the plate's own noise, no topological closing of
the cores. The coverage is taken as delivered, at full precision, with no
threshold anywhere near it. Both conventions are handled — colour premultiplied
over black is divided back out, colour left behind a mask is taken as it is —
and which one arrived is decided from the pixels, because premultiplied colour
can never stand above its own coverage and straight colour does constantly.

The one thing such a source cannot bring is **the sky it was shot against**,
because there is none left in it, and that is exactly the number the packing
calibrates a plate's level by. State it as `skyColour` (linear rgb) on the
plate's roster entry, or once for a whole set as `world.plateSky`. Without one
the chain says so and stops rather than inventing an exposure. `--rematte`
forces the estimating path back on.

**Derive it, do not guess it.** A plate is display referred: its cloud is stored
the way a picture stores a picture, and the sky beside it would have been stored
the same way. This world draws its sky from a model and puts it through a
composite nobody has to guess at, so the sky a plate would carry — in the plate's
own units — is this dome as this frame writes it, read back through the sRGB
transfer. That derivation takes one argument, the height the dome is read at,
because the dome is three times the radiance at
two degrees that it is at fifteen. That height is the only number the pixels
cannot check and it is where an unrecorded exposure ends up: set it once for a
whole set, judge it on the delivered frame's band contrasts, and never touch it
per plate. What differs between one plate and another is `shoulder`, and that
is measured — the cloud-to-sky ratio each plate carries at the texels over half
covered, against the set's own median.

Two things about such a source that a note accompanying it will get wrong, and
the pixels will not:

- **whether the colour is premultiplied.** `premultiplicationOf` answers it, and
  the answer is printed by `matte.mjs`. All fifteen of the set this was last run
  on were described as premultiplied over black and were not: between 58 and 90
  per cent of their fringe texels stand over their own coverage, which a
  premultiplied colour can never do. Dividing would have been a factor of up to
  four on every veil — and NOT dividing is not the same as doing nothing.
  Everything after this step is premultiplied, from the box average in
  `pack.mjs` to `premultipliedAlpha: true` in the renderer, so a straight source
  is multiplied by its own coverage exactly once, here. The delivery this
  paragraph was rewritten for shipped without that multiply and drew x1.18 the
  light its material has over the whole atlas, x3.81 on its worst veil.
- **how much of the frame is really semi-transparent.** Where an exporter caps
  alpha below 255 — 252 to 254 on that set — `sanitise.mjs`'s own line counts the
  whole body as partly covered and reads three to seven times the truth. Read
  the share under half coverage instead; `matte.mjs` reports it per piece as
  `veilShare`.

## The three things this chain will not do

It will not keep a body the frame cut through: a silhouette that ends in a
straight line is the defect the whole sky was rebuilt to be rid of, and the
answer is another source, not a softer blade.

It will not tell an opaque belly from a hole with sky behind it **by colour** —
nothing can, because a belly is lit by the sky and by nothing else. It answers
that question by topology instead, and the assertion is stated where it is made.

It will not decide where a piece stands. That is a composition, it is a design
decision, and it arrives as a file.

## The sequence the alpha set of fifteen was actually delivered by

Written down because two units of this campaign have now spent their first hour
rediscovering it.

The five steps in italics are the delivering unit's own scratch and are named
here by what they do, because the code that did them was never part of the
delivery and the next unit will write its own.

```
                                                 # the sky, into world.plateSky
node tools/clouds/ingest/sanitise.mjs <work>/sources --out <work>/clean
node tools/grade/check-png.mjs <work>/clean/*.png
node tools/clouds/ingest/matte.mjs <work>/clean/*.png --out <work>/pieces --preview
                                                 # the shoulders, measured
                                                 # the composition
                                                 # its coverage, predicted on a sheet
                                                 # the whole sky, not one pose
node tools/clouds/ingest/pack.mjs <work>/pieces --out <work>/atlas \
     --compose <work>/composition.json
node tools/clouds/ingest/validate.mjs --pieces <work>/pieces --atlas <work>/atlas \
     --out <work>/validation
node tools/clouds/ingest/reflect.mjs --atlas <work>/atlas --out <work>/reflections
cp .../{cloud-sprites.png,cloud-cover.png,clouds.json,cloud-equirect.png} assets-src/clouds/
npm run assets:build
```

Two things to know before repeating it.

**The build caches.** `npm run assets:build` decides a texture is unchanged
without opening the new one in some cases, and a browser will hold the old KTX2
for the same URL. Both were caught here, and both are the same failure: a frame
measured against an atlas that is not the one on disk. Delete the three
`public/assets/textures/cloud-*.ktx2` before the build when a repack matters,
and check that the delivered frame is byte for byte reproducible across a
reload before believing any number taken from it.

**Repack when the composition moves anything**, not only a height. Since the
rate is stated where a piece stands, a change of scale changes what the atlas
holds as well as where it goes.

## Retouching a few plates out of a set

There is ONE scale for the whole atlas, so a colour changed on one plate rescales
the texels of every other one. Measured on a retouch of three plates out of
fifteen: sixteen parts in a hundred thousand, which put a difference of one level
in 255 on half a per cent of the texels of every untouched tile. Nothing in the
frame sees it — and it is still the difference between a delivery that can PROVE
it changed three plates and one that can only say so, because a tile whose texels
are identical encodes to identical UASTC blocks (they are cut to a multiple of
four and gutter eight apart for exactly this reason) and one whose texels moved
does not.

So `pack.mjs` prints `level measured <n>` to full precision on every run, and
`--holdLevel <n>` writes the atlas at the scale a previous run measured instead
of at this one's. Take the number from the previous run's own line — the manifest
can only carry it rounded — and check the texel count the run reports over the
level, because holding a scale far from the material's own stops the brightest
thousandth being a thousandth. It is for a retouch and not for a fresh delivery.

## Judging the delivered frame

The chain above ends at an atlas. Whether the atlas was any good is decided on
frames taken from the running world, and two of the instruments that decide it
live beside the chain rather than in the scratch of whichever unit needed them
last. Both are here because they were rewritten from scratch more than once and
each rewrite cost a survey.

**`tools/grade/measure-purity.mjs` — how white the white is, at the pose the
frame was taken at.** The percentiles are weighted by solid angle and the low
one is the reading that matters: it says whether the darkest of the cloud's
white is still white or has gone grey. It takes the pose by name from
`tools/grade/lib/survey-poses.mjs` and derives the horizon, the hill floor and
the per-pixel solid angle from it, because the survey is taken at fields of 45
and 72 and at pitches from −25 to 85 and a ruler standing at one of them reads
nothing on the others.

```
node tools/grade/measure-purity.mjs <shots>/<tag>--b-270.png \
     --bare <shots>/<tag>-nudo--b-270.png --pose b-270
```

`--bare` is the twin of the same pose at the same instant of the world's clock
with the weather switched off. Give it whenever there is one: on any pose the
reference stone mask does not cover, intersecting with the twin is the only
thing keeping tower and hill out of a reading about cloud. Both readings are
printed and they agree at the reference framing, which is what says the second
is not a different rule.

**`tools/grade/lib/dressed-frame.mjs` — the guard that a frame carries the
world at all.** A capture that sleeps a fixed number of seconds and then shoots
cannot notice that the sleep stopped being long enough. Twice in one campaign
that produced a full survey of frames with no world in them — once the bare dome
alone, once pure black with the context alive and no error on the console — and
both runs reported success. The module waits on a condition instead: mean
luminance rules out black, its deviation rules out the smooth dome, and it
throws saying which of the two it hit. It holds no browser driver of its own —
the caller passes in how to render and how to read back — so a capture script
imports it instead of copying it, which is what the two rewrites were.
