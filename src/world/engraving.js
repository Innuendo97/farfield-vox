import {
  ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, RGFormat,
  UnsignedByteType,
} from 'three';
import { INK_STANDOFF, INK_THICKNESS } from './voxel/pure.js';

// What stands on the face of a monolith, and what it leaves on the stone.
//
// THE WRITING IS NOT CUT INTO THIS STONE ANY MORE, and that is the whole of
// what changed here. It used to be a two channel map — a glow and the shading
// of a groove — projected onto the wall in metres of stone, and it read
// perfectly while a course of that wall was one flat rectangle. It stopped
// reading the day the wall became BOXES: a projection lands on a block's
// reveals and its soffits exactly as happily as on its front, so every upright
// joint and every course line went straight through a glyph, and the committente
// read back that «il testo e i simboli dei monoliti soffrono le linee scure
// dove i cubi si separano, e questo rende complicata la lettura».
//
// SO THE LETTERS ARE BODIES (E-DECISIONI24). Every glyph, every icon, the rule
// and the little chart are cut as SOLIDS standing clear of the wall — eight
// centimetres off it, which is further than the proudest block can reach, and
// three centimetres thick. A joint cannot cut a letter that is not on the wall,
// and that is a property of the construction rather than of a threshold
// somebody has to keep tuning.
//
// WHAT IS LEFT ON THE STONE IS WHAT A BODY STANDING OFF IT REALLY DOES TO IT,
// and it is two things rather than one. It LIGHTS the wall behind it — the
// reference shows a narrow halo, far bluer than the stroke it surrounds (blue
// over red 64 at one or two pixels out and still 35 at eight to fourteen —
// E-PIETRA2) — and it SHADOWS it, which is the thing that makes a letter read
// as standing off a wall at all. So the map still has two channels and neither
// of them is the one it used to carry: red is the halo, green is the letters'
// own SILHOUETTE, and src/world/voxel/masonry.js walks the ray from a fragment
// towards the sun to the plane the letters stand in and asks the green channel
// whether one is there. The groove channel is gone with the groove it
// described. Nothing in either is a second opinion about where a letter is:
// the halo, the silhouette and the body are drawn from the SAME display list,
// at the same place, in one composition.
//
// AND THE COMPOSITION ITSELF IS UNTOUCHED. Where the type sits on a face, how
// large it is, how the lines break and which distance sets their size are the
// arithmetic they were, so the pose the campaign is judged at reads the glyphs
// on the pixels the reference puts them on — less the parallax that eight
// centimetres of standoff costs on a face seen at an angle, which is MEASURED
// in the verbale rather than compensated for. A body standing off a wall really
// is displaced, and hiding that would be drawing a decal again.

// Texels per metre of face. Fixed rather than per block, so a letter of a given
// size is drawn with the same number of texels wherever it is; at this density
// the smallest word in the reference is a little over twenty texels tall, which
// stays clean when the walker puts their face against the stone.
const TEXELS_PER_METRE = 160;

// Everything below is in metres on the face, at the size a block twenty one
// metres away carries. The reference draws its type at a nearly constant size
// on screen rather than on the stone, so the further block has the larger
// letters; SCALE_DISTANCE is where that reference distance sits, and the clamp
// keeps the sixth block — which stands ten metres behind the walker and has no
// framing to match — from being engraved in miniature.
const SCALE_DISTANCE = 21;
const SCALE_RANGE = [0.85, 1.5];

const TITLE_CAP = 0.225;
const NUMBER_CAP = 0.145;
const LIST_CAP = 0.142;
const LIST_PITCH = 0.31;
const CODE_CAP = 0.142;
const CODE_PITCH = 0.40;

// Gaps down the composition, measured off the reference: icon, then the number,
// then the title, a rule under it, then the list. Everything after the icon is
// baseline to baseline, which is how the reference is set and the only way a
// title of two lines does not push the rest of the block down by a line.
const ICON_HEIGHT = 0.92;
const ICON_WIDTH = 1.05;
const GAP_ICON_NUMBER = 0.44;
const GAP_NUMBER_TITLE = 0.58;
const TITLE_LEADING = 1.30;
const GAP_TITLE_RULE = 0.22;
const GAP_RULE_LIST = 0.34;
const GAP_LIST_CODE = 0.60;
const GAP_CODE_CHART = 1.30;

// Where the composition sits on the face, as a fraction of its height and its
// width. Solved off the reference by projecting the framing back onto each face
// (tools/monoliths/faces.mjs), not judged by eye.
const MARGIN_LEFT = 0.175;
const TOP_OF_BLOCK = 0.955;
const RULE_RIGHT = 0.74;

// How far across the face a line of writing may reach before it is set narrower.
// The reference never lets a word run past this, and the text comes from a CV
// rather than from the picture: a job title nobody chose for its length has to
// fit the stone it is cut into, not the other way round.
const MARGIN_RIGHT = 0.94;

// The cut, in metres: how far the two walls of the groove are apart on the
// surface, and how deep the floor of it reads.
const GROOVE_OFFSET = 0.022;
const GROOVE_FLOOR = 0.42;
const GROOVE_DARK = 0.55;
const GROOVE_LIGHT = 0.5;

// The halo: how far it reaches into the stone around a stroke, in metres of
// face, and how strongly it is laid.
//
// BOTH REFITTED, AND THEY HAD TO BE, BECAUSE WHAT THEY DESCRIBE HAS CHANGED.
// These two were set while the halo was painted UNDERNEATH a solid white
// stroke on the same wall: what they had to do was blend out of a core that
// was right there, and they were never read against the reference on their own.
// The core is a BODY now and stands eight centimetres off the stone, so what
// these two paint is the whole of what the reference calls the glow, and they
// are measured against it directly for the first time.
//
// THE READING, through tools/monoliths/inchiostro.mjs, at the fitted pose, as
// the level one, two, four, eight and fourteen pixels out from a stroke against
// that stroke's own level (the day target, the five fronts pooled):
//
//   target            0.307 / 0.270 / 0.272 / 0.245 / 0.232   on 01
//   delivered         0.482 / 0.407 / 0.338 / 0.302 / 0.245
//   0.035 at 0.20     0.351 / 0.308 / 0.265 / 0.226 / 0.238
//
// The far end of all three is the STONE and agrees; what the delivered halo was
// doing was adding half as much again to the two pixels next to every stroke,
// and those are the two pixels the eye reads an edge against. The committente's
// own sentence about the reference is that the glow is «stretto», and
// E-DECISIONI23 threw out a wider one on E-PIETRA2's measurement before this
// unit was dispatched. The Michelson contrast at the edge of a stroke follows:
// pooled over the five fronts it goes 0.249 delivered, 0.434 at 0.20, against
// the reference's 0.387.
const HALO = 0.035;
const HALO_ALPHA = 0.20;

const DEG = Math.PI / 180;

const FONT_FAMILY = 'Farfield Sans';
const FONT_URL = 'fonts/inter-latin.woff2';

let fontPromise = null;

/**
 * Loads the face the engraving is set in.
 *
 * A self hosted variable Inter: geometric, with thin enough stems at the light
 * end to match the reference, and a Latin subset that already covers the
 * accented capitals the Italian headings need.
 */
export function loadEngravingFont(base = './') {
  if (fontPromise) return fontPromise;
  if (typeof FontFace === 'undefined' || !document.fonts) {
    fontPromise = Promise.resolve(false);
    return fontPromise;
  }
  const url = `${base.endsWith('/') ? base : `${base}/`}${FONT_URL}`;
  const face = new FontFace(FONT_FAMILY, `url(${url}) format('woff2')`, { weight: '200 600' });
  fontPromise = face.load()
    .then(() => { document.fonts.add(face); return true; })
    .catch(() => false);
  return fontPromise;
}

const ICONS = {
  // Line drawings, in a unit box with the origin at its top left. They are
  // written out as paths rather than loaded as images so they carry the same
  // stroke weight as the type and scale with it.
  lampadina(ctx) {
    ctx.beginPath();
    ctx.arc(0.5, 0.42, 0.235, Math.PI * 0.85, Math.PI * 0.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0.335, 0.56); ctx.lineTo(0.40, 0.70);
    ctx.moveTo(0.665, 0.56); ctx.lineTo(0.60, 0.70);
    ctx.moveTo(0.40, 0.70); ctx.lineTo(0.60, 0.70);
    ctx.moveTo(0.415, 0.785); ctx.lineTo(0.585, 0.785);
    ctx.moveTo(0.445, 0.865); ctx.lineTo(0.555, 0.865);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI * (1.08 + i * 0.12);
      ctx.moveTo(0.5 + Math.cos(a) * 0.33, 0.42 + Math.sin(a) * 0.33);
      ctx.lineTo(0.5 + Math.cos(a) * 0.43, 0.42 + Math.sin(a) * 0.43);
    }
    ctx.stroke();
  },
  cubo(ctx) {
    ctx.beginPath();
    ctx.moveTo(0.5, 0.10); ctx.lineTo(0.90, 0.32); ctx.lineTo(0.90, 0.74);
    ctx.lineTo(0.5, 0.96); ctx.lineTo(0.10, 0.74); ctx.lineTo(0.10, 0.32);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0.10, 0.32); ctx.lineTo(0.5, 0.53); ctx.lineTo(0.90, 0.32);
    ctx.moveTo(0.5, 0.53); ctx.lineTo(0.5, 0.96);
    ctx.stroke();
  },
  codice(ctx) {
    ctx.beginPath();
    ctx.moveTo(0.30, 0.16); ctx.lineTo(0.05, 0.50); ctx.lineTo(0.30, 0.84);
    ctx.moveTo(0.70, 0.16); ctx.lineTo(0.95, 0.50); ctx.lineTo(0.70, 0.84);
    ctx.moveTo(0.58, 0.08); ctx.lineTo(0.42, 0.92);
    ctx.stroke();
  },
  valigetta(ctx) {
    ctx.beginPath();
    ctx.moveTo(0.10, 0.34); ctx.lineTo(0.90, 0.34); ctx.lineTo(0.90, 0.86);
    ctx.lineTo(0.10, 0.86); ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0.36, 0.34); ctx.lineTo(0.36, 0.20); ctx.lineTo(0.64, 0.20);
    ctx.lineTo(0.64, 0.34);
    ctx.moveTo(0.10, 0.55); ctx.lineTo(0.90, 0.55);
    ctx.moveTo(0.44, 0.55); ctx.lineTo(0.56, 0.55);
    ctx.stroke();
  },
  bersaglio(ctx) {
    for (const r of [0.40, 0.26, 0.12]) {
      ctx.beginPath();
      ctx.arc(0.46, 0.54, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0.46, 0.54); ctx.lineTo(0.90, 0.12);
    ctx.moveTo(0.74, 0.12); ctx.lineTo(0.90, 0.12); ctx.lineTo(0.90, 0.28);
    ctx.stroke();
  },
  busta(ctx) {
    ctx.beginPath();
    ctx.moveTo(0.08, 0.26); ctx.lineTo(0.92, 0.26); ctx.lineTo(0.92, 0.76);
    ctx.lineTo(0.08, 0.76); ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0.08, 0.26); ctx.lineTo(0.50, 0.56); ctx.lineTo(0.92, 0.26);
    ctx.stroke();
  },
};

/**
 * The equaliser under the code of the third block.
 *
 * The reference draws a row of short bars there. Their heights are taken from
 * the section's own timeline — how much is written about each entry — so the
 * figure is a picture of the content rather than a decoration that happens to
 * sit on it.
 */
function chartBars(section, count) {
  const entries = section.timeline || [];
  const weights = entries.map((entry) => (
    (entry.riassunto || '').length + (entry.dettaglio || '').length
      + (entry.tecnologie || []).length * 40
  ));
  const peak = Math.max(1, ...weights);
  const bars = [];
  for (let i = 0; i < count; i++) {
    const weight = weights.length ? weights[i % weights.length] / peak : 0.5;
    // One entry per bar would give a dozen steps and a flat tail; the reference
    // draws a ragged row. The stagger is a hash of the position, so it is the
    // same row every time the page is opened.
    const stagger = ((Math.sin(i * 12.9898 + Number(section.id) * 7.13) * 43758.5453) % 1 + 1) % 1;
    bars.push(0.16 + 0.84 * Math.min(1, weight ** 0.7 * (0.45 + 0.85 * stagger)));
  }
  return bars;
}

/**
 * Breaks lines to a budget expressed in capitals rather than in pixels.
 *
 * The canvas is not available where the composition is decided, and it does not
 * need to be: the type is set at a known cap height in a known face, and how
 * many of its capitals fit across the stone is enough to place the breaks. The
 * measured squeeze in paint() takes up whatever is left over.
 */
function wrap(lines, capsPerLine) {
  const out = [];
  for (const line of lines) {
    let current = '';
    for (const word of line.split(' ')) {
      const next = current ? `${current} ${word}` : word;
      if (current && next.length > capsPerLine) {
        out.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    out.push(current);
  }
  return out;
}

/** Everything the engraving of one section draws, as a flat display list. */
function compose(section, metrics) {
  const { width, height, scale } = metrics;
  const incisione = section.incisione || {};
  const list = incisione.parolechiave || [];
  const draw = [];

  const left = width * MARGIN_LEFT;
  let y = height * (1 - TOP_OF_BLOCK);

  const icon = ICONS[section.icona] ? section.icona : null;
  if (icon) {
    draw.push({
      kind: 'icon', name: icon, x: left, y,
      width: ICON_WIDTH * scale, height: ICON_HEIGHT * scale,
    });
    y += ICON_HEIGHT * scale + GAP_ICON_NUMBER * scale;
  }

  // The sixth block is the way back out of the hub, not one of the five the
  // reference numbers, so it carries no number.
  if (section.id !== '06') {
    y += GAP_ICON_NUMBER * scale;
    draw.push({ kind: 'text', text: section.id, x: left, y, cap: NUMBER_CAP * scale, weight: 400 });
  }

  // The title is broken to the width of the stone rather than set narrower: it
  // is the largest thing on the face and squeezing "SVILUPPATORE SOFTWARE" onto
  // one line makes it a different typeface from everything under it. The
  // reference sets that very title on three lines for the same reason.
  const titleLines = wrap(
    String(incisione.titolo || section.titolo || '').split('\n'),
    (width * MARGIN_RIGHT - left) / (TITLE_CAP * scale * 0.80),
  );
  y += GAP_NUMBER_TITLE * scale;
  for (let i = 0; i < titleLines.length; i++) {
    if (i > 0) y += TITLE_CAP * TITLE_LEADING * scale;
    draw.push({
      kind: 'text', text: titleLines[i], x: left, y, cap: TITLE_CAP * scale, weight: 300,
    });
  }

  y += GAP_TITLE_RULE * scale;
  draw.push({ kind: 'rule', x0: left - 0.03 * width, x1: width * RULE_RIGHT, y });

  y += GAP_RULE_LIST * scale;
  for (let i = 0; i < list.length; i++) {
    if (i > 0) y += LIST_PITCH * scale;
    draw.push({ kind: 'text', text: list[i], x: left, y, cap: LIST_CAP * scale, weight: 320 });
  }

  if (incisione.snippet) {
    const lines = String(incisione.snippet).split('\n');
    y += GAP_LIST_CODE * scale;
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) y += CODE_PITCH * scale;
      draw.push({
        kind: 'text', text: lines[i], x: left, y, cap: CODE_CAP * scale, weight: 320, mono: true,
      });
    }

    y += GAP_CODE_CHART * scale;
    draw.push({
      kind: 'chart', bars: chartBars(section, 34), x: left, y,
      width: width * 0.58, height: 0.62 * scale,
    });
  }

  return draw;
}

/** Sets the font of one line and returns the tracking that goes with it. */
function selectFont(ctx, item, squeeze) {
  // Cap height, not em size: the reference is laid out against the tops of its
  // capitals and an em would put every line in the wrong place.
  const size = item.cap * squeeze / 0.727;
  const family = item.mono ? `${FONT_FAMILY}, monospace` : `${FONT_FAMILY}, sans-serif`;
  ctx.font = `${item.weight} ${size}px ${family}`;
  // Wide tracking, as the reference sets its headings. Canvas has no tracking,
  // so the string is walked a glyph at a time.
  return item.cap * squeeze * (item.mono ? 0.02 : 0.045);
}

function lineWidth(ctx, item, squeeze) {
  const track = selectFont(ctx, item, squeeze);
  let width = 0;
  for (const glyph of item.text) width += ctx.measureText(glyph).width + track;
  return width - track;
}

function paint(ctx, list, metrics) {
  const { pixelsPerMetre, limit } = metrics;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const item of list) {
    if (item.kind === 'text') {
      // Set narrower rather than clipped or wrapped: a keyword cut across two
      // lines would break the composition the reference sets, and one running
      // off the arris would look like a mistake in the stone.
      let squeeze = 1;
      const room = limit - item.x;
      const full = lineWidth(ctx, item, 1);
      if (full > room) squeeze = Math.max(0.55, room / full);
      const track = selectFont(ctx, item, squeeze);
      let x = item.x;
      for (const glyph of item.text) {
        ctx.fillText(glyph, x, item.y);
        x += ctx.measureText(glyph).width + track;
      }
    } else if (item.kind === 'rule') {
      ctx.lineWidth = Math.max(1, 0.018 * pixelsPerMetre);
      ctx.beginPath();
      ctx.moveTo(item.x0, item.y);
      ctx.lineTo(item.x1, item.y);
      ctx.stroke();
    } else if (item.kind === 'icon') {
      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.scale(item.width, item.height);
      ctx.lineWidth = Math.max(1, 0.028 * pixelsPerMetre) / Math.min(item.width, item.height);
      ICONS[item.name](ctx);
      ctx.restore();
    } else if (item.kind === 'chart') {
      const step = item.width / item.bars.length;
      ctx.lineWidth = Math.max(1, step * 0.34);
      ctx.beginPath();
      for (let i = 0; i < item.bars.length; i++) {
        const x = item.x + step * (i + 0.5);
        ctx.moveTo(x, item.y);
        ctx.lineTo(x, item.y - item.bars[i] * item.height);
      }
      ctx.stroke();
    }
  }
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}


// ------------------------------------------------------- the writing as a body

// THE LATTICE THE LETTERS ARE CUT ON IS THE ONE THE COMPOSITION IS DRAWN AT,
// which is TEXELS_PER_METRE above and not a second density of its own. That is
// the whole reason a body and the halo it throws cannot drift apart: one
// lattice, one display list, one paint. At six and a quarter millimetres a stem
// of the smallest line on these faces — the keyword list, set at a cap of
// 142 mm — is a little over two cells wide, so it survives the threshold as a
// stroke and not as a dotted line. It is also what makes the staircase
// invisible where it has to be: at the pose the six are judged from a cell is a
// QUARTER of a pixel on the third block, and at the three and a half metres the
// committente stands from the sixth it is a pixel and two thirds — a voxel
// world showing its lattice, in a world made of voxels, and only where a walker
// has walked up to read it.

// How much of a cell has to be covered for it to become stone.
//
// A HALF, WHICH IS THE ONE VALUE THAT DOES NOT CHANGE THE WEIGHT OF THE TYPE.
// The mandate is that the writing keeps «stessa tinta, taglia e posizione»,
// and a threshold is a place where a body can quietly gain weight the
// composition never asked for: cut at a third, a stem covering 1.4 cells comes
// back 2 cells wide and the keyword list is set half a weight bolder than the
// reference's. Cut at a half, coverage is conserved on average and a stroke is
// as heavy as it was drawn. The thinnest thing on these faces is the rule under
// a title, and it is 2.9 cells wide before a cell is thresholded at all, so
// nothing the composition draws is lost at this cut. It was measured rather
// than assumed: cut at a third, the ink the five fronts come back as at the
// fitted pose is 9 to 12 per cent more than at a half — 5,307 px against 4,695
// on the third block — and the list of the sixth block read visibly bolder than
// the delivered engraving beside it.
const SOLID_COVER = 0.50;

/**
 * The composition as coverage: how much of each cell the writing covers.
 *
 * ONE PAINT AND TWO READERS. This is where the BODY is cut from, by a
 * threshold, and it is also the SILHOUETTE the stone's own shadow term reads —
 * so a letter and the shadow it throws cannot be a pixel out of step with each
 * other, because they are the same paint.
 *
 * Painted on a canvas that has NEVER been given a filter, which is the whole
 * reason it can be read back at all: see the note in engrave() below, where the
 * same lesson cost eight seconds of the arrival.
 */
function inkCoverage(list, metrics) {
  const { width, height } = metrics;
  const ctx = makeCanvas(width, height).getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  paint(ctx, list, metrics);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const cover = new Uint8Array(width * height);
  for (let i = 0, o = 0; i < cover.length; i += 1, o += 4) cover[i] = pixels[o];
  return cover;
}

/** Which of those cells are stone: the threshold, and nothing else. */
function inkCells(cover) {
  const cells = new Uint8Array(cover.length);
  const floor = Math.round(SOLID_COVER * 255);
  for (let i = 0; i < cover.length; i++) cells[i] = cover[i] >= floor ? 1 : 0;
  return cells;
}

/**
 * The lit cells of a bitmap, merged into as few rectangles as they will make.
 *
 * The plain greedy walk: take the first cell nobody has claimed, run right
 * while the row holds, then run down while the whole run holds. On type this
 * turns a stem into one rectangle and a curve into a staircase of them, which
 * is exactly where the triangles of this body go.
 */
function greedyRects(cells, width, height) {
  const taken = new Uint8Array(width * height);
  const out = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!cells[i] || taken[i]) continue;
      let w = 1;
      while (x + w < width && cells[i + w] && !taken[i + w]) w += 1;
      let h = 1;
      for (; y + h < height; h += 1) {
        const row = (y + h) * width + x;
        let whole = true;
        for (let k = 0; k < w; k++) {
          if (!cells[row + k] || taken[row + k]) { whole = false; break; }
        }
        if (!whole) break;
      }
      for (let dy = 0; dy < h; dy++) {
        taken.fill(1, (y + dy) * width + x, (y + dy) * width + x + w);
      }
      out.push([x, y, w, h]);
    }
  }
  return out;
}

/**
 * The silhouette of a bitmap in one direction, as runs.
 *
 * A side wall stands where a lit cell has an unlit neighbour, and consecutive
 * such cells along the wall are ONE wall. That is what keeps the flanks of this
 * body from costing a quad a cell: the outline of a letter is a few dozen runs,
 * not a few thousand cells.
 *
 * @param {number} dir 0 = the wall on the cell's left, 1 = right, 2 = above,
 *                     3 = below, in bitmap coordinates (y runs down)
 */
function edgeRuns(cells, width, height, dir) {
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : cells[y * width + x]);
  const out = [];
  if (dir < 2) {
    const step = dir === 1 ? 1 : -1;
    for (let x = 0; x < width; x++) {
      let y = 0;
      while (y < height) {
        if (at(x, y) && !at(x + step, y)) {
          let run = 1;
          while (y + run < height && at(x, y + run) && !at(x + step, y + run)) run += 1;
          out.push([x, y, run]);
          y += run;
        } else y += 1;
      }
    }
  } else {
    const step = dir === 3 ? 1 : -1;
    for (let y = 0; y < height; y++) {
      let x = 0;
      while (x < width) {
        if (at(x, y) && !at(x, y + step)) {
          let run = 1;
          while (x + run < width && at(x + run, y) && !at(x + run, y + step)) run += 1;
          out.push([x, y, run]);
          x += run;
        } else x += 1;
      }
    }
  }
  return out;
}

// What each face of the body is worth as light, as a share of the core.
//
// THE FRONT CARRIES E-PIETRA2's CORE AT THE LEVEL IT WAS DELIVERED AT, which is
// what keeps the judgement from moving: the stroke a walker looks at is the
// same triple times the same gain it has been since the ink was re-anchored,
// so the pose the campaign is judged on reads the level it has read all along.
//
// THE FLANKS ARE NEARLY DARK, AND THAT IS THE «OMBRA PROPRIA» THE MANDATE ASKS
// FOR. A flank is the one face of a letter a reader is NOT looking at: it is
// turned along the wall, it takes a different sun and a different sky by the
// ordinary light of this world, and if it also burned at the core's level the
// letter would read as a fatter letter rather than as a letter with a side. At
// a seventh it reads as an edge — a dark rim down one side of every stroke and
// under every bar, which is what a body standing off a wall shows and what a
// decal cannot. It was swept, and a third was the value that made a letter look
// merely bolder.
//
// The back is darker again and is there for one reason only: a skin with a hole
// in it draws whatever is behind the hole, which is the defect the sockets of
// src/world/voxel/courses.js were cut wrong for twice. It faces the wall eight
// centimetres away and nobody will ever read a level off it.
export const INK_FACE = { front: 1.0, side: 0.14, back: 0.05 };

/**
 * The writing of one face, cut as bodies standing off the stone.
 *
 * WORLD METRES, NOT FACE METRES, and that is so the six can be ONE MESH. Six
 * blocks stand at six turns in this hub; a body handed back in each block's own
 * frame would need a transform each, which is six matrices, six draw calls and
 * six of everything else. Handed back in the world they concatenate.
 *
 * @param {object} monolith the entry from src/world/layout.js
 * @param {Uint8Array} cover the coverage inkCoverage() painted
 * @param {object} metrics  the metrics that coverage was painted at
 * @returns {object} positions, normals, a tone per vertex, indices and a census
 */
function cutSolids(monolith, cover, metrics) {
  const { width, height } = metrics;
  const cells = inkCells(cover);

  const faces = greedyRects(cells, width, height);
  const runs = [0, 1, 2, 3].map((dir) => edgeRuns(cells, width, height, dir));
  const quads = faces.length * 2 + runs.reduce((sum, r) => sum + r.length, 0);

  const angle = monolith.rotationY * DEG;
  const right = [Math.cos(angle), 0, -Math.sin(angle)];
  const front = [Math.sin(angle), 0, Math.cos(angle)];
  const centre = [
    monolith.position.x, monolith.baseY + monolith.size[1] / 2, monolith.position.z,
  ];
  // Where a cell boundary stands, in the face's own two axes. The bitmap is
  // addressed exactly as the map was — x across from the left edge, y DOWN from
  // the top — so a body and the halo it casts are drawn off one set of
  // coordinates and there is nothing to keep in step.
  const [faceWidth, faceHeight] = [monolith.size[0], monolith.size[1]];
  const acrossAt = (x) => (x / width - 0.5) * faceWidth;
  const upAt = (y) => (0.5 - y / height) * faceHeight;
  const near = monolith.size[2] / 2 + INK_STANDOFF;
  const far = near + INK_THICKNESS;

  const positions = new Float32Array(quads * 12);
  const normals = new Float32Array(quads * 12);
  const tones = new Float32Array(quads * 4);
  const indices = new Uint32Array(quads * 6);
  let v = 0;
  let n = 0;
  let t = 0;
  let i = 0;

  // One quad, wound off the face's own right handed basis (across, up, out), so
  // that every winding below falls out of the basis instead of being guessed and
  // fixed up afterwards — the lesson the sockets of the masonry cost twice.
  const quad = (normal, corners, tone) => {
    for (const [across, up, out] of corners) {
      positions[v] = centre[0] + right[0] * across + front[0] * out;
      positions[v + 1] = centre[1] + up;
      positions[v + 2] = centre[2] + right[2] * across + front[2] * out;
      v += 3;
      normals[n] = normal[0];
      normals[n + 1] = normal[1];
      normals[n + 2] = normal[2];
      n += 3;
      tones[t] = tone;
      t += 1;
    }
    const base = t - 4;
    indices[i] = base; indices[i + 1] = base + 1; indices[i + 2] = base + 2;
    indices[i + 3] = base; indices[i + 4] = base + 2; indices[i + 5] = base + 3;
    i += 6;
  };

  const out = [front[0], 0, front[2]];
  const back = [-front[0], 0, -front[2]];
  const east = [right[0], 0, right[2]];
  const west = [-right[0], 0, -right[2]];
  const up = [0, 1, 0];
  const down = [0, -1, 0];

  for (const [x, y, w, h] of faces) {
    const a0 = acrossAt(x);
    const a1 = acrossAt(x + w);
    const u1 = upAt(y);
    const u0 = upAt(y + h);
    quad(out, [[a0, u0, far], [a1, u0, far], [a1, u1, far], [a0, u1, far]], INK_FACE.front);
    quad(back, [[a1, u0, near], [a0, u0, near], [a0, u1, near], [a1, u1, near]], INK_FACE.back);
  }

  // The four flanks. Each run is a wall one cell thick standing between the two
  // depths, wound so its lit side is the side anybody can see.
  for (const [x, y, run] of runs[0]) {
    const a = acrossAt(x);
    const u1 = upAt(y);
    const u0 = upAt(y + run);
    quad(west, [[a, u0, near], [a, u0, far], [a, u1, far], [a, u1, near]], INK_FACE.side);
  }
  for (const [x, y, run] of runs[1]) {
    const a = acrossAt(x + 1);
    const u1 = upAt(y);
    const u0 = upAt(y + run);
    quad(east, [[a, u0, far], [a, u0, near], [a, u1, near], [a, u1, far]], INK_FACE.side);
  }
  for (const [x, y, run] of runs[2]) {
    const u = upAt(y);
    const a0 = acrossAt(x);
    const a1 = acrossAt(x + run);
    quad(up, [[a0, u, near], [a1, u, near], [a1, u, far], [a0, u, far]], INK_FACE.side);
  }
  for (const [x, y, run] of runs[3]) {
    const u = upAt(y + 1);
    const a0 = acrossAt(x);
    const a1 = acrossAt(x + run);
    quad(down, [[a0, u, far], [a1, u, far], [a1, u, near], [a0, u, near]], INK_FACE.side);
  }

  let lit = 0;
  for (let c = 0; c < cells.length; c++) lit += cells[c];
  return {
    positions,
    normals,
    tones,
    indices,
    quads,
    // What it cost and what it is made of, for the panel and for the guard.
    census: {
      id: monolith.id,
      cells: lit,
      faces: faces.length,
      flanks: quads - faces.length * 2,
      quads,
      triangles: quads * 2,
      cellMetres: faceWidth / width,
      standoff: INK_STANDOFF,
      thickness: INK_THICKNESS,
    },
  };
}

/**
 * The writing of one section: the bodies that stand off the face, and the glow
 * they leave on it.
 *
 * @param {object} section  a parsed content/*.json
 * @param {object} monolith the entry from src/world/layout.js
 * @param {number} distance metres from the reference camera, which is what sets
 *                          the size of the type
 * @returns {object} { texture, solids } — the halo and the silhouette for the
 *                   stone, and the bodies themselves, in world metres
 */
export function engrave(section, monolith, distance) {
  const [faceWidth, faceHeight] = [monolith.size[0], monolith.size[1]];
  const pixelsPerMetre = TEXELS_PER_METRE;
  const width = Math.max(8, Math.round(faceWidth * pixelsPerMetre));
  const height = Math.max(8, Math.round(faceHeight * pixelsPerMetre));
  const scale = Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], distance / SCALE_DISTANCE));

  const metrics = {
    width, height, scale: scale * pixelsPerMetre, pixelsPerMetre, limit: width * MARGIN_RIGHT,
  };
  const list = compose(section, {
    width, height, scale: scale * pixelsPerMetre,
  });

  // THE HALO IS BLURRED ON A CANVAS OF ITS OWN, AND THE ONE REASON IS THE
  // READBACK AT THE BOTTOM OF THIS FUNCTION.
  //
  // A 2D context that has ever been given a `filter` stops being the software
  // surface `willReadFrequently` asked for: Chrome moves it onto the GPU,
  // because that is where a blur is cheap. Everything on that canvas is then
  // cheap EXCEPT getting the pixels back, and this function exists to get the
  // pixels back. Measured, on the six faces this world engraves, with the two
  // canvases side by side and the same sizes on both:
  //
  //   getImageData on the glow, which carried the filter   179 / 448 / 594 /
  //                                                        759 / 830 / 5047 ms
  //   getImageData on the cut, which never did             3 / 4 / 7 / 4 / 8 / 9
  //
  // Five seconds, on one face, for one call -- and it is not linear in the
  // area: four times the pixels cost twenty eight times the time, which is a
  // layer being rasterised again and not a buffer being copied. Those six calls
  // were EIGHT SECONDS of the arrival, more than every layer of the world put
  // together, and no bench had ever seen them because they run in the
  // continuation of an `await requestAnimationFrame` and land in the GAP
  // between two frames rather than inside either of them.
  //
  // So the filter goes on a scratch canvas that nobody reads, and its result is
  // composited in as an image. The canvas that is read has never seen a filter
  // and comes back in milliseconds.
  //
  // AND THE WHITE STROKE IS NOT PAINTED OVER IT ANY MORE, which is the one line
  // of this paragraph that changed. What red carries is the HALO alone -- the
  // light a body standing eight centimetres off the wall throws back onto it --
  // and the stroke itself is cut as stone in cutSolids() above. Painting it
  // here as well would be the letter drawn twice: once as a body and once as
  // the decal the committente sent back.
  const glow = makeCanvas(width, height).getContext('2d', { willReadFrequently: true });
  glow.fillStyle = '#000000';
  glow.fillRect(0, 0, width, height);
  const blur = HALO * pixelsPerMetre;
  const halo = makeCanvas(width, height).getContext('2d');
  if (typeof halo.filter === 'string') {
    halo.fillStyle = '#000000';
    halo.fillRect(0, 0, width, height);
    halo.filter = `blur(${blur.toFixed(1)}px)`;
    halo.fillStyle = `rgba(255,255,255,${HALO_ALPHA})`;
    halo.strokeStyle = `rgba(255,255,255,${HALO_ALPHA})`;
    paint(halo, list, metrics);
    halo.filter = 'none';
    glow.drawImage(halo.canvas, 0, 0);
  }

  const cover = inkCoverage(list, metrics);
  const solids = cutSolids(monolith, cover, metrics);

  const inkData = glow.getImageData(0, 0, width, height).data;
  const packed = new Uint8Array(width * height * 2);
  for (let i = 0, o = 0, c = 0; c < cover.length; i += 2, o += 4, c += 1) {
    packed[i] = inkData[o];
    packed[i + 1] = cover[c];
  }

  const texture = new DataTexture(packed, width, height, RGFormat, UnsignedByteType);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return { texture, solids };
}
