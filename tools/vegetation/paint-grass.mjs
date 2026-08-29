import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../grade/lib/framing.mjs';
import { writeCleanPng } from '../grade/lib/png.mjs';
import { linearToSrgb } from '../grade/lib/color.mjs';
import { dilate, Canvas } from './lib/canvas.mjs';

// Paints the sheet of tufts the meadow is ACCENTED with.
//
// WHAT THIS SHEET IS NOW, AND IT IS NOT WHAT IT WAS. It used to be the meadow:
// a carpet of cards was how grass got drawn, and everything here was arranged
// around carrying the meadow's own colour so that a field of them read as the
// ground rather than as a rug laid over it. That is over. The mass of the
// meadow is CUBES -- measured on both targets, in eight declared windows: the
// share of meadow pixels a cube face cannot draw is seven tenths of one per
// cent against an instrument floor of two tenths, and every one of the sixty
// two candidates, looked at, was a cube's own corner, a scrap of stone or the
// stalk of a flower. Not one was a blade.
//
// So the card has one job left, and the night target is where it is visible:
// inside the pool of a lamp there are four to six SPRAYS of fine blades on a
// hundred square metres of ground, twenty five by fifteen centimetres each,
// blades two to three centimetres wide, and the meadow shows none anywhere
// else. By day an accent of that size disappears into the mass. That is the
// whole role: rare, fine, deep, and invisible until something stands close to
// it.
//
// WHY THE PIGMENTS ARE NOT MEASURED HERE ANY MORE. They were, and that is the
// defect. assets-src/vegetation/palette.json is sampled by sample-plants.mjs
// off the PHOTOREAL reference and divided by the light a Cycles bake put on the
// ground -- two things this world no longer has. Read against the voxel target
// its grass runs 2.4 to 1 green over blue where the target's open meadow runs
// nearly 9 to 1, and a sheet painted from it is grey-green whatever it is
// multiplied by. The ground of this world states its own reflectance in one
// place, and that is where the sheet takes it from now: a card has to be the
// colour of the cubes it stands among, and the way to guarantee that is to read
// the cubes' own number rather than a second measurement of the same meadow.
//
// Everything is drawn rather than photographed for the same reason the ground
// is painted: a scan carries its own sun, its own season and its own licence,
// and the one thing this sheet must agree with is a reference image.

const OUT_DIR = join(REPO_ROOT, 'assets-src', 'vegetation');
const OUT = join(OUT_DIR, 'grass-atlas.png');
const SIZE = Number(process.argv.find((a) => a.startsWith('--size='))?.slice(7) || 1024);

// The sheet is a column of wide, low cells, because that is the shape of the
// card: a tuft is broader than it is tall, and cells that match it spend their
// texels on the tuft instead of on the air above it.
const COLUMNS = 2;
const ROWS = 4;
const CELLS = COLUMNS * ROWS;

// Empty band around the art of every cell. Mip levels three and four are
// reached by the far half of the ring, and without a margin the top of one tuft
// would start bleeding into the roots of the cell below it.
const MARGIN = 12;

// THE CARD THIS SHEET IS PAINTED FOR, IN METRES, AND IT IS WRITTEN OUT.
//
// It is here and not in src/world/vegetation.js because a blade is specified in
// CENTIMETRES and a sheet is painted in texels: the only thing that turns one
// into the other is how much ground a cell covers. Held in two places those two
// would drift, and the drift would be invisible -- a sheet painted for a card
// half a metre wide, stretched onto one a quarter of a metre wide, is a sheet
// of blades twice as fat with nothing anywhere saying so. So the number is
// declared once, here, written into grass.json, and read back by the card.
//
// Both are the night target's own spray, measured at v = 11.8 px per voxel:
// 29 x 17 px is 25 x 15 cm, which is two and a half voxels by one and a half.
const CARD = { width: 0.25, height: 0.15 };

// How wide a blade is, in centimetres, from the same spray. The sheet converts
// it with the cell's own texels per metre, so it stays two to three centimetres
// whatever the sheet is sized at.
const BLADE_CM = { min: 2.0, max: 3.0 };

// Where the meadow's reflectance is stated, and it is V1's seat rather than a
// copy of it. Read and not imported: this file is a build tool run under plain
// node and the material is a browser module three imports deep into JSON.
const GROUND_MATERIAL = join(REPO_ROOT, 'src', 'world', 'voxel', 'material.js');
const RECIPE = join(REPO_ROOT, 'assets-src', 'materia', 'ricetta.json');

/**
 * The reflectance of the meadow, from the material that draws it.
 *
 * It throws rather than falling back. A default here would be a second opinion
 * about the colour of the ground that went on being painted after V1 moved the
 * first one, and the two would be told apart by looking at a picture.
 */
function meadowAlbedo() {
  const text = readFileSync(GROUND_MATERIAL, 'utf8');
  const found = [...text.matchAll(
    /albedo:\s*new Vector3\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/g,
  )];
  if (found.length !== 1) {
    throw new Error(`${GROUND_MATERIAL} no longer states exactly one ground albedo `
      + `(${found.length} found): the sheet cannot be painted at a colour nobody publishes`);
  }
  return found[0].slice(1, 4).map(Number);
}

/**
 * How far the light inside a tuft is allowed to run, from the frozen recipe.
 *
 * A blade is dark at its root and bright at its tip, and that gradient cannot
 * come from the light: the ground's light is a map of the GROUND, it knows
 * nothing about the inside of a tuft, and a tuft lit flat from root to tip
 * reads as a printed pattern rather than as grass.
 *
 * WHAT THE THREE RUNGS ARE. They are not a measurement of a blade -- nobody has
 * one, the target's sprays are twenty nine pixels across. They are the meadow's
 * own measured range of face brightness by orientation, which is the range a
 * blade standing in that meadow has to live INSIDE: a root darker than the
 * meadow's darkest flank, or a tip brighter than its brightest top, would be a
 * population neither target shows. Taken from the window the campaign fixed.
 */
function shadeLadder() {
  const recipe = JSON.parse(readFileSync(RECIPE, 'utf8'));
  const entry = recipe.entries.find((e) => e.id === 'orientation-ladder');
  const text = entry?.measured?.['finestra-demo'];
  const rungs = /^\s*([\d.]+)\s*\/\s*([\d.]+)\s*\/\s*([\d.]+)\s*$/.exec(text || '');
  if (!rungs) {
    throw new Error(`${RECIPE} no longer publishes the orientation ladder at finestra-demo: `
      + `read "${text}"`);
  }
  return { tip: Number(rungs[1]), body: Number(rungs[2]), root: Number(rungs[3]) };
}

const scale = (c, k) => c.map((v) => v * k);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// Rec.709 on linear light: what "as bright as the meadow" means when the hue is
// fixed and only the level is being solved for.
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * The three pigments a blade is drawn with.
 *
 * THE MEADOW'S OWN COLOUR, TIMES THE MEADOW'S OWN RANGE OF SHADE, AND NOTHING
 * ELSE. There is no multiplier above one anywhere in it, and that is the whole
 * repair. The three that used to be here -- body at 1.52, tip at 3.40, dry at
 * 1.85 on red -- were a COMPENSATION: a card is mostly root and mostly in its
 * own shade, so a carpet of cards centred on the ground's reflectance drew the
 * meadow about a unit and a half of colour error darker than the bare ground,
 * and the pigments were lifted until it did not. They were lifted through unity
 * on a pigment whose green was already 1.24, and the write below clamps at one:
 * on the sheet that shipped, 64.3% of the opaque texels had their GREEN pinned
 * at full scale. Clipping the largest channel is precisely the operation that
 * destroys saturation, so the sheet measured 0.23 where the target's meadow
 * measures 0.72, and it read as pale straw.
 *
 * THE COMPENSATION IS NOT NEEDED, because the thing it compensated for is gone:
 * the cards no longer carry the meadow's mean colour. The cubes do. A sheet at
 * the ground's own reflectance is now simply correct, and it fits under one with
 * room to spare -- which is asserted below rather than hoped for.
 *
 * @param {number[]} albedo  the ground's reflectance, from the material
 * @param {object} rungs     tip / body / root, from the frozen recipe
 * @param {number} hold      what keeps the SHEET's mean on the albedo: see main
 */
function pigments(albedo, rungs, hold) {
  return {
    root: scale(albedo, hold * rungs.root),
    body: scale(albedo, hold * rungs.body),
    tip: scale(albedo, hold * rungs.tip),
  };
}

// Value noise on an integer lattice, shared with everything else that is
// painted offline in this project.
function hash(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Deterministic stream of numbers: the sheet has to be the same sheet twice. */
function stream(seed) {
  let n = seed;
  return () => {
    n += 1;
    return hash(n, seed * 7919 + 13);
  };
}

// THE SHAPE, WHICH IS A ROSETTE AND NOT A CLUMP.
//
// The one place either target shows this object plainly is the spray at
// (352,862) of the night target, in the pool of a lamp, at v = 11.8 px per
// voxel: thin straight blades RADIATING from a single point at the ground,
// spread over most of a half turn, the outer ones shorter than the upright
// ones, tapering to points, with dark ground visible between them. It is a
// spider plant, not a hedge.
//
// That is a different construction from the one that shipped, and the
// difference is the whole of what "thorny burst" meant. The old cell gathered
// forty six blades along a BASELINE, each leaning a little, which at any width
// fills into a slab with a scalloped bottom; ten blades from ONE FOOT leave the
// gaps the target shows, because the gaps between rays of a fan open with
// distance from the foot.
//
// EIGHT TO FOURTEEN BLADES AND NOT THIRTY TWO TO FIFTY FOUR. Twenty five
// centimetres of spray holds about ten blades at two and a half centimetres
// each, which is what the target's twenty nine pixels hold at two and a half
// pixels a blade.
//
// AND NO FLOWERS. Three of the eight cells used to carry three to ten painted
// white heads, and those heads are the white bursts the comparison plate shows
// standing over the render's meadow with nothing answering them in the target.
// A flower in these targets is a CUBE head on a sub-voxel stalk, one to one and
// a half voxels across; it is an object and not a mark on a sheet of grass, and
// it belongs to the session that builds it. Painting one here would put a
// second, wrong flower field under the right one.
//
// `fan` is how much of a half turn the blades are spread over, `height` how
// long they are as a share of the card, `arch` how much more upright a blade
// leaves the ground than it arrives at its tip.
const VARIANTS = [
  { blades: 11, fan: 0.86, height: 0.92, arch: 0.42 },
  { blades: 9, fan: 0.62, height: 1.00, arch: 0.30 },
  { blades: 13, fan: 0.96, height: 0.84, arch: 0.55 },
  { blades: 14, fan: 0.78, height: 0.95, arch: 0.38 },
  { blades: 8, fan: 0.54, height: 1.00, arch: 0.25 },
  { blades: 12, fan: 0.92, height: 0.80, arch: 0.58 },
  { blades: 10, fan: 0.72, height: 0.90, arch: 0.44 },
  { blades: 11, fan: 0.66, height: 0.97, arch: 0.33 },
];

// The widest the fan is ever opened, in radians either side of upright. Just
// over eighty degrees: the target's outermost blades lie almost along the
// ground, and a blade past level is one lying on its back.
const FAN_HALF = 1.42;

/**
 * One blade, as a tapered arc.
 *
 * Drawn by marching the curve rather than by filling an outline: a blade tapers
 * to a point, and the fill rule of a polygon that thin depends on which side of
 * a texel centre it happens to fall, which is what turns a field of grass into
 * a field of dashes.
 */
function blade(canvas, ink, spec) {
  const {
    x0, y0, x1, y1, cx, cy, width, colours, shade,
  } = spec;
  const steps = Math.max(24, Math.round((Math.abs(y0 - y1) + Math.abs(x0 - x1)) * 1.5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    // Quadratic through the control point: one arc, no inflection, which is
    // what a blade of grass is.
    const px = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const py = u * u * y0 + 2 * u * t * cy + t * t * y1;
    // Widest a little above the ground and tapered to a point. Not widest AT
    // the ground: the mark is a disc, so a blade at full width from its first
    // step lays a half circle of that radius across its own foot, and eight of
    // those over one foot is the rounded pad that made the first pass of this
    // sheet read as a succulent rather than as grass. And never under a texel:
    // a blade thinner than that stops being drawn and starts flickering.
    const open = Math.min(1, 0.34 + t * 5.5);
    const half = Math.max(0.55, width * open * (1 - t) ** 0.85);
    const colour = t < 0.5
      ? mix(colours.root, colours.body, t * 2)
      : mix(colours.body, colours.tip, (t - 0.5) * 2);
    canvas.stamp(px, py, half, scale(colour, shade), ink);
  }
}

/**
 * One tuft: a fan of blades out of one foot, laid out in METRES.
 *
 * The layout is worked in metres and converted to texels at the end because a
 * cell is not the card's own aspect -- the sheet's cells are two to one and the
 * card is five to three -- so an angle set in texels would be a different angle
 * on the ground, and the fan is the whole silhouette.
 */
function paintCell(canvas, cell, variant, colours, seed, geom) {
  const rand = stream(seed);
  const footX = cell.x0 + cell.width / 2;
  const footY = cell.y1 - MARGIN;

  // Back to front, so the blades in front cover the ones behind and the tuft
  // has a depth the alpha channel alone could never give it. The slot in the
  // fan is kept from before the sort: where a blade stands in the fan and how
  // near the front it is are two independent things.
  const blades = [];
  for (let i = 0; i < variant.blades; i++) {
    blades.push({ slot: (i + 0.5) / variant.blades - 0.5, depth: rand(), r: [rand(), rand(), rand(), rand()] });
  }
  blades.sort((a, b) => b.depth - a.depth);

  for (const entry of blades) {
    const [ra, rb, rc, rd] = entry.r;
    // Stratified across the fan and then jittered inside its own slot. Drawn
    // independently instead, a fan of ten leaves holes wide enough to read as
    // two tufts and doubles two blades up into one fat one.
    const angle = (entry.slot * 2 + (ra - 0.5) / variant.blades)
      * FAN_HALF * variant.fan;
    const lean = Math.abs(Math.sin(angle));
    // The outer blades are shorter. That is in the target -- the spray is
    // wider than it is tall -- and it is also what keeps a blade inside its
    // own cell without a clamp that would flatten the fan's rim.
    const length = CARD.height * variant.height * (0.55 + 0.45 * rb)
      * (1 - 0.38 * lean);

    const tipX = Math.sin(angle) * length;
    const tipY = -Math.cos(angle) * length;
    // THE ARCH, AND IT IS BUILT SO IT CANNOT DIP UNDER THE GROUND. A blade
    // leaves the sheath steeper than it ends and bends over on the way out, so
    // the control point is carried along a bearing NEARER UPRIGHT than the
    // tip's own. Written the other way round -- a control point pushed DOWN
    // from the chord by a droop in metres -- the outer blades of the widest
    // fans dipped a fifth of the card below their own foot and painted a pad
    // of roots into the next cell of the sheet, which every card in the ring
    // then carried as a smudge along its top edge. Because the bearing below
    // is always nearer the vertical than the tip's, the whole curve stays
    // between the foot and the tip in height: it cannot happen again.
    const bearing = angle * (1 - variant.arch * (0.6 + 0.8 * rc));

    // A foot that is a point exactly is a star, and the target's spray is a
    // small patch of ground with blades out of it. A centimetre either way.
    const jitterX = (rd - 0.5) * 0.02;

    blade(canvas, 1, {
      x0: footX + jitterX * geom.perMetreX,
      y0: footY,
      x1: footX + (jitterX + tipX) * geom.perMetreX,
      y1: footY + tipY * geom.perMetreY,
      cx: footX + (jitterX + Math.sin(bearing) * length * 0.55) * geom.perMetreX,
      cy: footY - Math.cos(bearing) * length * 0.55 * geom.perMetreY,
      width: geom.halfMin + (geom.halfMax - geom.halfMin) * rc,
      colours,
      // Blades at the back of the fan are in its shade. The range is wide on
      // purpose: it is the only thing that stops a tuft reading as a flat decal.
      shade: 0.74 + 0.26 * (1 - entry.depth) ** 0.7,
    });
  }
}

/**
 * One whole sheet, at a given hold, with the alpha it will ship with.
 *
 * Painted twice by main(): the alpha does not depend on the pigments, so the
 * first pass exists only to measure what the sheet's mean comes to and the
 * second is the one that is written.
 */
function paint(albedo, rungs, hold) {
  const colours = pigments(albedo, rungs, hold);
  const cellWidth = SIZE / COLUMNS;
  const cellHeight = SIZE / ROWS;
  const canvas = new Canvas(SIZE, SIZE);

  // Metres into texels, one scale per axis, through the ground a cell covers.
  // The stamp is round, so a blade is held to width ACROSS the card -- which is
  // the dimension the two to three centimetres were measured on, and the one a
  // mostly upright blade shows.
  const geom = {
    perMetreX: (cellWidth - MARGIN * 2) / CARD.width,
    perMetreY: (cellHeight - MARGIN * 2) / CARD.height,
  };
  geom.halfMin = BLADE_CM.min * 0.005 * geom.perMetreX;
  geom.halfMax = BLADE_CM.max * 0.005 * geom.perMetreX;

  const cells = [];
  for (let i = 0; i < CELLS; i++) {
    const col = i % COLUMNS;
    const row = Math.floor(i / COLUMNS);
    const cell = {
      x0: col * cellWidth,
      y0: row * cellHeight,
      x1: (col + 1) * cellWidth,
      y1: (row + 1) * cellHeight,
      width: cellWidth,
      height: cellHeight,
    };
    paintCell(canvas, cell, VARIANTS[i], colours, 101 + i * 37, geom);
    cells.push({
      index: i,
      // Half a texel inside, so the hardware filter never reaches across the
      // margin into the neighbouring cell.
      rect: [
        (cell.x0 + 0.5) / SIZE, (cell.y0 + 0.5) / SIZE,
        (cell.x1 - 0.5) / SIZE, (cell.y1 - 0.5) / SIZE,
      ],
    });
  }

  return { canvas, cells, colours, geom };
}

// Where the shader cuts the alpha channel. Restated from src/world/vegetation.js
// because the sheet's own mean has to be taken over the texels that are DRAWN:
// averaging in the dilation skirt would report a sheet nobody sees.
const ALPHA_CUTOFF = 0.34;

/** The mean linear colour of a sheet, over the texels the shader keeps. */
function sheetMean(canvas) {
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < canvas.alpha.length; i++) {
    if (canvas.alpha[i] < ALPHA_CUTOFF) continue;
    for (let c = 0; c < 3; c++) sum[c] += canvas.colour[i * 3 + c];
    n++;
  }
  return { mean: sum.map((v) => v / Math.max(1, n)), covered: n };
}

function main() {
  const albedo = meadowAlbedo();
  const rungs = shadeLadder();

  // WHAT THE HOLD IS, AND WHY IT IS SOLVED RATHER THAN CHOSEN.
  //
  // The three rungs say how a blade is shaded from root to tip; they do not say
  // how bright the sheet as a whole comes out, because that depends on how much
  // of a blade is root -- a tapered mark lays most of its ink at the wide end.
  // What must be true is that the sheet's own mean is the meadow's reflectance,
  // so that an accent standing in the meadow is the meadow's colour and not a
  // lighter or darker green stood next to it. So the sheet is painted once to
  // find out what it comes to, and the whole ladder is scaled by one number so
  // that it comes to the right thing. ONE number, and a scalar: it moves the
  // level and cannot move the hue.
  const trial = paint(albedo, rungs, 1);
  const hold = luma(albedo) / luma(sheetMean(trial.canvas).mean);

  const { canvas, cells, colours, geom } = paint(albedo, rungs, hold);

  // NOTHING MAY REACH FULL SCALE, AND IT IS ASSERTED HERE RATHER THAN MEASURED
  // AFTERWARDS. The brightest thing the sheet can hold is the tip of a blade at
  // the front of its clump, which is the tip pigment undimmed; if that is under
  // one then no texel can clip, by construction, and the defect this repair is
  // about cannot come back by accident.
  const brightest = Math.max(...colours.tip);
  if (brightest >= 1) {
    throw new Error(`the tip pigment reaches ${brightest.toFixed(3)} of full scale: `
      + 'the sheet would clip its largest channel and lose its saturation, which is '
      + 'the whole defect this brush was rewritten to close');
  }

  // Colour pushed out under the transparent texels. Without it the mip chain
  // averages the black of an empty texel into the rim of every blade and the
  // far half of the ring is drawn with a dark outline round each tuft.
  dilate(canvas, 12);

  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  let covered = 0;
  let clipped = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const alpha = canvas.alpha[i];
    if (alpha > 0.5) covered++;
    for (let c = 0; c < 3; c++) {
      const value = canvas.colour[i * 3 + c];
      const byte = Math.round(Math.min(1, Math.max(0, linearToSrgb(value))) * 255);
      if (byte >= 254 && alpha >= ALPHA_CUTOFF) clipped++;
      pixels[i * 4 + c] = byte;
    }
    pixels[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  }
  if (clipped) {
    throw new Error(`${clipped} channels of drawn texels came out at full scale`);
  }

  const { mean, covered: drawn } = sheetMean(canvas);
  return {
    pixels, cells, coverage: covered / (SIZE * SIZE), colours, hold, geom, mean, drawn, albedo,
  };
}

mkdirSync(OUT_DIR, { recursive: true });
const {
  pixels, cells, coverage, colours, hold, geom, mean, drawn, albedo,
} = main();
const bytes = await writeCleanPng(pixels, { width: SIZE, height: SIZE, channels: 4 }, OUT);

writeFileSync(join(OUT_DIR, 'grass.json'), `${JSON.stringify({
  size: SIZE,
  columns: COLUMNS,
  rows: ROWS,
  margin: MARGIN,
  // The card this sheet was painted for. src/world/vegetation.js reads these
  // two and does not carry its own: see the note over CARD above.
  card: CARD,
  bladeCm: BLADE_CM,
  coverage: Number(coverage.toFixed(4)),
  // What the ground says its reflectance is, and what the sheet came out at.
  // Written so a reader can check the hold did what it says without repainting.
  meadowAlbedo: albedo,
  sheetMean: mean.map((v) => Number(v.toFixed(5))),
  hold: Number(hold.toFixed(5)),
  pigments: Object.fromEntries(Object.entries(colours)
    .map(([key, value]) => [key, value.map((v) => Number(v.toFixed(5)))])),
  cells,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${OUT} (${(bytes / 1024).toFixed(0)} kB)\n`);
process.stdout.write(`${CELLS} tufts, ${(coverage * 100).toFixed(1)}% of the sheet covered, `
  + `${drawn} texels drawn\n`);
process.stdout.write(`card ${CARD.width} x ${CARD.height} m, blades ${BLADE_CM.min}-${BLADE_CM.max} cm `
  + `= ${(geom.halfMin * 2).toFixed(1)}-${(geom.halfMax * 2).toFixed(1)} texels\n`);
process.stdout.write(`meadow albedo ${albedo.map((v) => v.toFixed(3)).join(', ')}, `
  + `hold ${hold.toFixed(3)}, sheet mean ${mean.map((v) => v.toFixed(3)).join(', ')}\n`);
