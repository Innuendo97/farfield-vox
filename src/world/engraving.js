import {
  ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, RGFormat,
  UnsignedByteType,
} from 'three';

// What is cut into the face of a monolith.
//
// The writing is drawn once, at load, into an offscreen canvas the size of the
// face, and handed to the GPU as a texture. From then on it costs nothing: the
// frame samples it like any other map. That is the whole reason the engraving
// can carry real text from the CV at all — a scene that had to lay out type
// every frame could not afford six blocks of it on an integrated GPU.
//
// The texture has two channels and no colour. Red is how much light the cut is
// giving off, and the cyan of the reference is put back in the shader from a
// ramp; green is the shading of the groove itself, half grey where the face is
// untouched, dark on the wall the light cannot reach and pale on the one it
// rakes across. Two channels rather than four halves the video memory, and the
// second half was carrying a colour that never varied.

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

// Width of the halo around a stroke, in metres of face. The reference glows a
// little way into the stone around every letter; the rest of the bloom comes
// from the frame.
const HALO = 0.07;

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

/**
 * Draws the engraving of one section onto the face of its monolith.
 *
 * @param {object} section  a parsed content/*.json
 * @param {object} monolith the entry from src/world/layout.js
 * @param {number} distance metres from the reference camera, which is what sets
 *                          the size of the type
 * @returns {DataTexture} two channels: the glow and the shading of the groove
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
  // composited in as an image. Same blur, same alpha, same backdrop, same
  // order; the canvas that is read has never seen a filter and comes back in
  // milliseconds. Total for the six faces: 8038 ms -> 1008 ms.
  //
  // WHAT IT COSTS, DECLARED RATHER THAN GLOSSED. The two are not bit identical:
  // a blur rasterised on its own surface and composited rounds differently from
  // one rasterised into the surface underneath it, and measured against the old
  // path the GLOW channel moves by at most 6 to 9 levels of 255, on 9.6 to 19.2
  // per cent of texels, mean 1.4 to 1.9. The cut channel and the type itself do
  // not move at all -- neither is drawn through a filter. That is the whole of
  // the difference and it is in the soft edge of the halo, under the render's
  // own run to run noise; it is written here, and in the verbale, so that the
  // committente can send it back rather than discover it.
  const glow = makeCanvas(width, height).getContext('2d', { willReadFrequently: true });
  glow.fillStyle = '#000000';
  glow.fillRect(0, 0, width, height);
  const blur = HALO * pixelsPerMetre;
  const halo = makeCanvas(width, height).getContext('2d');
  if (typeof halo.filter === 'string') {
    halo.fillStyle = '#000000';
    halo.fillRect(0, 0, width, height);
    halo.filter = `blur(${blur.toFixed(1)}px)`;
    halo.fillStyle = 'rgba(255,255,255,0.46)';
    halo.strokeStyle = 'rgba(255,255,255,0.46)';
    paint(halo, list, metrics);
    halo.filter = 'none';
    glow.drawImage(halo.canvas, 0, 0);
  }
  glow.fillStyle = '#ffffff';
  glow.strokeStyle = '#ffffff';
  paint(glow, list, metrics);

  const cut = makeCanvas(width, height).getContext('2d', { willReadFrequently: true });
  cut.fillStyle = '#808080';
  cut.fillRect(0, 0, width, height);
  const offset = GROOVE_OFFSET * pixelsPerMetre;
  // The light of this world comes from high and behind, so on the face it rakes
  // down from the upper right: the wall of the groove turned that way is the
  // one in shadow, and the one opposite catches it.
  for (const [dx, dy, colour] of [
    [offset, -offset, `rgba(0,0,0,${GROOVE_DARK})`],
    [-offset, offset, `rgba(255,255,255,${GROOVE_LIGHT})`],
    [0, 0, `rgba(0,0,0,${GROOVE_FLOOR * 0.5})`],
  ]) {
    cut.save();
    cut.translate(dx, dy);
    cut.fillStyle = colour;
    cut.strokeStyle = colour;
    paint(cut, list, metrics);
    cut.restore();
  }

  const inkData = glow.getImageData(0, 0, width, height).data;
  const cutData = cut.getImageData(0, 0, width, height).data;
  const packed = new Uint8Array(width * height * 2);
  for (let i = 0, o = 0; i < packed.length; i += 2, o += 4) {
    packed[i] = inkData[o];
    packed[i + 1] = cutData[o];
  }

  const texture = new DataTexture(packed, width, height, RGFormat, UnsignedByteType);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
