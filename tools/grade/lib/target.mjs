import { join } from 'node:path';
import sharp from 'sharp';
import { FRAME, REPO_ROOT, projectorFor } from './framing.mjs';

// The reference image, and the parts of it that may be compared against a
// render. Two things must never end up in a comparison: the interface, which is
// drawn in the DOM and not in the scene, and anything the placeholder scene
// does not contain yet.

export const TARGET_PATH = join(REPO_ROOT, 'target.png');

const DEG = Math.PI / 180;

// Interface panels of the reference image, in pixels, with a margin. Nothing
// drawn inside these belongs to the scene, but the panels have no backing plate:
// the text sits straight on the sky.
const UI_RECTS = [
  { x0: 0, y0: 0, x1: 288, y1: 298 },        // welcome block and key caps
  { x0: 0, y0: 682, x1: 248, y1: 941 },      // compass
  { x0: 752, y0: 852, x1: 948, y1: 941 },    // interact prompt
  { x0: 1372, y0: 852, x1: 1672, y1: 941 },  // menu and map hints
];

// A glyph is brighter than the sky it is drawn on, and small enough that a wide
// average of its neighbourhood is still the sky. Anything standing this far
// above that average is interface, not weather.
const GLYPH_CONTRAST = 5;
const GLYPH_RADIUS = 14;
const GLYPH_DILATE = 4;

// The scale the sky under a panel is rebuilt at, in pixels.
//
// Removing the glyphs is not enough on its own, and the bake proved it: what
// survives a threshold is the antialiased skirt of every stroke, a fraction of
// a level per pixel, and projecting that into the sky left a legible ghost of
// the greeting hanging in the top left corner of every frame. Discarding the
// panel outright is worse — it is the darkest corner of the sky and the only
// reading the reference gives twelve degrees off the axis on that side, and
// with it gone the fill puts a pale wall there.
//
// So the panel is rebuilt rather than removed: every pixel under it becomes a
// weighted average of the sky between the lines. A blur this wide is four
// hundred times narrower than the gradient the corner carries, which therefore
// survives intact, and thirty times wider than the spacing of the type, which
// does not. The reference has no cloud behind this panel, so there is nothing
// else in there to lose.
const PANEL_REBUILD_SIGMA = 14;

// Everything below this row can be hills, water or ground in the reference, and
// the placeholder scene has none of it: only rows above it are unambiguously
// sky. The value is the top of the highest distant hill in the reference.
export const SKY_FLOOR_ROW = 420;

// Sky that reaches down to the horizon, read in the gaps between the monoliths
// where the reference shows haze rather than terrain.
const HORIZON_SKY_RECTS = [
  { x0: 952, y0: 430, x1: 1000, y1: 498 },
  { x0: 1186, y0: 398, x1: 1230, y1: 462 },
  { x0: 656, y0: 428, x1: 724, y1: 484 },
];

function inRect(x, y, r) {
  return x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
}

export async function readTarget() {
  const { data, info } = await sharp(TARGET_PATH).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== FRAME.width || info.height !== FRAME.height) {
    throw new Error(`reference image is ${info.width}x${info.height}, expected ${FRAME.width}x${FRAME.height}`);
  }
  return { width: info.width, height: info.height, channels: 3, data };
}

/**
 * Screen space silhouette of the placeholder blocks, from the very numbers the
 * scene is built with. Anything inside it is stone in the render, so it can
 * never be compared as sky.
 *
 * Exported because the sky bake needs the other half of the statement: inside
 * this silhouette there is sky that nobody has ever seen, and it has to be
 * rebuilt all the way down to the foot of the stone. The sky line below is
 * where the reference stops being unambiguously sky, which is a different
 * question and a higher line.
 *
 * AND IT IS DRAWN THROUGH THE FITTED CAMERA NOW, WHOLE (U-GRADE-1). What stood
 * here built its own projection, and the comment three lines into the loop said
 * out loud what was wrong with it: «the camera looks north». The camera does
 * not look north. It looks 1.818 degrees east of it, which on this focal is
 * 36.8 px -- nearly four times the ten pixels of margin this mask's whole
 * safety rests on. The eye was wrong the other way, standing the WALKER's
 * sentinel at (0, floor + 1.70, SPAWN.z) where the fit stands the LENS at
 * (0.599, 1.583, 14.215), and the two errors partly cancelled: the five
 * silhouette centres came out 23.3, 15.0, 15.3, 0.5 and 1.8 px west of the
 * reference's own instead of the 36.8 the yaw alone would have cost.
 *
 * THAT CANCELLATION IS WHY IT COULD NOT BE HALF CORRECTED. Putting the yaw
 * back without the eye moves the near blocks further from the picture than
 * they were; both go, in one statement, through framing.mjs's projectTarget,
 * which is now the campaign's only projection of this camera.
 */
export async function buildStoneMask(width = FRAME.width, height = FRAME.height) {
  const layout = await import(new URL('../../../src/world/layout.js', import.meta.url).href);
  const { MONOLITHS, PLATFORM } = layout;

  const project = projectorFor({ width, height });

  const mask = new Uint8Array(width * height);

  const boxes = MONOLITHS.map((m) => ({
    x: m.position.x, z: m.position.z, rotationY: m.rotationY,
    w: m.size[0], h: m.size[1], d: m.size[2], y0: m.baseY,
  }));
  boxes.push({
    x: PLATFORM.x, z: PLATFORM.z, rotationY: PLATFORM.rotationY,
    w: PLATFORM.width, h: PLATFORM.height, d: PLATFORM.depth, y0: 0,
  });

  for (const b of boxes) {
    const c = Math.cos(b.rotationY * DEG);
    const s = Math.sin(b.rotationY * DEG);
    const pts = [];
    let behind = false;
    for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) {
      const lx = sx * b.w / 2;
      const lz = sz * b.d / 2;
      const at = project(
        b.x + lx * c + lz * s,
        b.y0 + sy * b.h,
        b.z - lx * s + lz * c,
      );
      if (!at) { behind = true; break; }
      pts.push([at.x, at.y]);
    }
    if (behind || pts.length === 0) continue;

    // The silhouette of a rotated block is its convex hull, not its bounding
    // box: filling the box instead would throw away the sky either side of
    // every monolith, which is most of the sky there is between them.
    // The hull is then grown a little, because the reference blocks are not
    // pixel identical to the reconstruction and a sliver of stone read as sky
    // would poison the fit. The margin is a fraction of the frame, not a pixel
    // count, or it would swallow the sky at reduced resolutions.
    const pad = Math.max(2, 10 * width / FRAME.width);
    fillHull(mask, width, height, grow(convexHull(pts), pad));
  }
  return mask;
}

function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

function grow(hull, pad) {
  const cx = hull.reduce((t, p) => t + p[0], 0) / hull.length;
  const cy = hull.reduce((t, p) => t + p[1], 0) / hull.length;
  return hull.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const length = Math.hypot(dx, dy) || 1;
    return [x + dx / length * pad, y + dy / length * pad];
  });
}

function fillHull(mask, width, height, hull) {
  const yMin = Math.max(0, Math.floor(Math.min(...hull.map((p) => p[1]))));
  const yMax = Math.min(height - 1, Math.ceil(Math.max(...hull.map((p) => p[1]))));
  for (let y = yMin; y <= yMax; y++) {
    const cy = y + 0.5;
    const crossings = [];
    for (let i = 0; i < hull.length; i++) {
      const [ax, ay] = hull[i];
      const [bx, by] = hull[(i + 1) % hull.length];
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) {
        crossings.push(ax + (cy - ay) / (by - ay) * (bx - ax));
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const x0 = Math.max(0, Math.floor(crossings[k]));
      const x1 = Math.min(width - 1, Math.ceil(crossings[k + 1]));
      for (let x = x0; x <= x1; x++) mask[y * width + x] = 1;
    }
  }
}

/** Interface glyphs of the reference, at full resolution. */
function glyphMask({ width, height, data }) {
  const luma = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    luma[i] = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2];
  }

  // Stepped by two: the neighbourhood is only there to say what the sky under
  // the panel is doing, and it says it just as well from a quarter of the
  // samples.
  const mask = new Uint8Array(width * height);
  eachPanelPixel(width, height, (x, y) => {
    let sum = 0;
    let n = 0;
    for (let dy = -GLYPH_RADIUS; dy <= GLYPH_RADIUS; dy += 2) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -GLYPH_RADIUS; dx <= GLYPH_RADIUS; dx += 2) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        sum += luma[yy * width + xx];
        n++;
      }
    }
    if (luma[y * width + x] > sum / n + GLYPH_CONTRAST) mask[y * width + x] = 1;
  });

  // Grown so the brightest part of the antialiased rim goes with it.
  const grown = new Uint8Array(mask);
  eachPanelPixel(width, height, (x, y) => {
    if (!mask[y * width + x]) return;
    for (let dy = -GLYPH_DILATE; dy <= GLYPH_DILATE; dy++) {
      for (let dx = -GLYPH_DILATE; dx <= GLYPH_DILATE; dx++) {
        const yy = y + dy;
        const xx = x + dx;
        if (yy < 0 || yy >= height || xx < 0 || xx >= width) continue;
        grown[yy * width + xx] = 1;
      }
    }
  });
  return grown;
}

function eachPanelPixel(width, height, visit) {
  for (const rect of UI_RECTS) {
    for (let y = rect.y0; y < Math.min(height, rect.y1); y++) {
      for (let x = rect.x0; x < Math.min(width, rect.x1); x++) visit(x, y);
    }
  }
}

let skyReferenceCache = null;

/**
 * The reference with the interface lifted off it.
 *
 * Under every panel the sky is rebuilt from the sky between the lines: a
 * Gaussian average over the pixels the glyph mask did not claim, wide enough
 * that nothing at the spacing of the type comes through it and narrow enough
 * that the gradient the corner carries does not move. This is the image the sky
 * bake reads, and only the sky bake: a comparison against the reference reads
 * the reference.
 */
export async function readSkyReference() {
  if (skyReferenceCache) return skyReferenceCache;
  const target = await readTarget();
  const { width, height } = target;
  const data = Buffer.from(target.data);
  const glyphs = glyphMask(target);

  const radius = Math.round(PANEL_REBUILD_SIGMA * 3);
  const taps = new Float64Array(radius * 2 + 1);
  for (let i = -radius; i <= radius; i++) {
    taps[i + radius] = Math.exp(-(i * i) / (2 * PANEL_REBUILD_SIGMA * PANEL_REBUILD_SIGMA));
  }

  // Separable, over the sky only: value and weight are carried through both
  // passes together and divided at the end, so a pixel with type all around it
  // takes the average of whatever sky is in reach rather than a hole.
  const sum = new Float64Array(width * height * 3);
  const weight = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    if (glyphs[i]) continue;
    weight[i] = 1;
    for (let c = 0; c < 3; c++) sum[i * 3 + c] = target.data[i * 3 + c];
  }

  const pass = (horizontal) => {
    const outSum = new Float64Array(width * height * 3);
    const outWeight = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = y * width + x;
        let w = 0;
        const acc = [0, 0, 0];
        for (let k = -radius; k <= radius; k++) {
          const sx = horizontal ? x + k : x;
          const sy = horizontal ? y : y + k;
          if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
          const so = sy * width + sx;
          if (weight[so] <= 0) continue;
          const tap = taps[k + radius];
          for (let c = 0; c < 3; c++) acc[c] += sum[so * 3 + c] * tap;
          w += weight[so] * tap;
        }
        outWeight[o] = w;
        for (let c = 0; c < 3; c++) outSum[o * 3 + c] = acc[c];
      }
    }
    sum.set(outSum);
    weight.set(outWeight);
  };

  // Only the rows and columns the panels touch are worth blurring, but the
  // separable passes are cheap enough over the whole frame that splitting them
  // by rectangle would buy nothing but a chance to get an index wrong.
  pass(true);
  pass(false);

  eachPanelPixel(width, height, (x, y) => {
    const o = y * width + x;
    if (weight[o] <= 0) return;
    for (let c = 0; c < 3; c++) {
      data[o * 3 + c] = Math.round(Math.min(255, Math.max(0, sum[o * 3 + c] / weight[o])));
    }
  });

  skyReferenceCache = { width, height, channels: 3, data };
  return skyReferenceCache;
}

// How far outside the projected silhouette the reference's own stone is looked
// for, how strong the step has to be to be believed, and how much clear of it
// the gather is then kept.
const STONE_SEARCH = 30;
const STONE_STEP = 8;
const STONE_GUARD = 2;

/**
 * Grows the silhouettes to the ones the reference actually drew.
 *
 * The mask is the scene's geometry projected, and the illustration drew its
 * blocks a little wider than the scene carries them — eleven pixels wider at the
 * left of the second monolith. Those eleven pixels are the lit narrow face of a
 * block: nearly white, four degrees tall, and straight to the pixel. Read as sky
 * they become the brightest thing for twenty degrees of bearing, and because
 * they are measurement rather than invention every correction downstream is
 * pinned to them — which is why the bright bar beside that monolith survived
 * every pass made at the fill. It is not a fill defect at all.
 *
 * So the silhouette is fitted to the reference before anything reads it. Down
 * each vertical edge the horizontal step is summed over every row that edge
 * occupies: an edge three hundred rows long adds up, and a cloud leaning on part
 * of it does not. Where the sum peaks well outside the mask, the mask is grown
 * out to that column and a little past it.
 *
 * Shared, because both bakes read the same picture and a block edge left in the
 * sky is a straight bright line in one and a straight bright line cut into a
 * sprite in the other.
 *
 * @returns {Array<string>} what was found, edge by edge, for the log
 */
export function fitStoneToReference(stone, reference) {
  const { width } = FRAME;
  const lum = (x, y) => {
    const o = (y * width + x) * 3;
    return 0.2126 * reference.data[o] + 0.7152 * reference.data[o + 1] + 0.0722 * reference.data[o + 2];
  };

  // Every vertical boundary of the mask, clustered into edges. A silhouette
  // leans, so the column an edge sits in moves a few pixels down its own
  // length; bucketing by column splits it in two and loses both halves.
  const sides = { '-1': [], 1: [] };
  for (let y = 0; y < SKY_FLOOR_ROW; y++) {
    let prev = 0;
    for (let x = 1; x < width; x++) {
      const here = stone[y * width + x];
      if (here !== prev) {
        sides[here ? -1 : 1].push({ y, x: here ? x : x - 1 });
        prev = here;
      }
    }
  }
  const edges = [];
  for (const dir of [-1, 1]) {
    const samples = sides[dir].sort((a, b) => a.x - b.x);
    let edge = null;
    for (const s of samples) {
      if (!edge || s.x - edge.last > 6) { edge = { dir, rows: [], last: s.x }; edges.push(edge); }
      edge.rows.push(s);
      edge.last = s.x;
    }
  }

  const found = [];
  for (const edge of edges) {
    if (edge.rows.length < 60) continue;
    let best = { k: 0, step: 0 };
    for (let k = 1; k <= STONE_SEARCH; k++) {
      let sum = 0;
      let n = 0;
      for (const r of edge.rows) {
        const x = r.x + edge.dir * k;
        if (x < 1 || x >= width - 1) continue;
        sum += lum(x - edge.dir, r.y) - lum(x + edge.dir, r.y);
        n++;
      }
      if (!n) continue;
      const step = sum / n;
      if (Math.abs(step) > Math.abs(best.step)) best = { k, step };
    }
    if (Math.abs(best.step) < STONE_STEP || best.k < STONE_GUARD) continue;
    for (const r of edge.rows) {
      for (let k = 0; k <= best.k + STONE_GUARD; k++) {
        const x = r.x + edge.dir * k;
        if (x < 0 || x >= width) break;
        stone[r.y * width + x] = 1;
      }
    }
    const column = Math.round(edge.rows.reduce((t, r) => t + r.x, 0) / edge.rows.length);
    found.push(`${edge.dir < 0 ? 'sinistro' : 'destro'}@${column}+${best.k}(${best.step.toFixed(0)})`);
  }
  return found;
}

/**
 * Boolean mask, one byte per pixel, of the reference pixels that are sky and
 * only sky.
 */
export async function buildSkyMask(width = FRAME.width, height = FRAME.height) {
  const blocked = await buildStoneMask(width, height);
  const scaleX = width / FRAME.width;
  const scaleY = height / FRAME.height;
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const fx = Math.min(FRAME.width - 1, Math.round(x / scaleX));
      const fy = Math.min(FRAME.height - 1, Math.round(y / scaleY));
      if (blocked[y * width + x]) continue;
      const high = fy < SKY_FLOOR_ROW;
      const horizon = HORIZON_SKY_RECTS.some((r) => inRect(fx, fy, r));
      if (high || horizon) mask[y * width + x] = 1;
    }
  }
  return mask;
}

/**
 * Named regions used for the numeric read out. They are all inside the sky
 * mask or on surfaces the placeholder scene actually has.
 */
export const REGIONS = [
  { id: 'sky-top-left', kind: 'sky', x0: 292, y0: 8, x1: 512, y1: 74 },
  { id: 'sky-top-mid', kind: 'sky', x0: 540, y0: 8, x1: 700, y1: 84 },
  { id: 'sky-top-right', kind: 'sky', x0: 1430, y0: 6, x1: 1620, y1: 44 },
  { id: 'cloud-tower-lit', kind: 'sky', x0: 1064, y0: 74, x1: 1236, y1: 168 },
  { id: 'cloud-tower-shade', kind: 'sky', x0: 1252, y0: 186, x1: 1416, y1: 296 },
  { id: 'cloud-left', kind: 'sky', x0: 332, y0: 204, x1: 556, y1: 300 },
  // The gaps between the monoliths are narrow slivers, so the lowest sky that
  // can be measured without catching stone is at the two edges of the frame.
  { id: 'sky-horizon-mid', kind: 'sky', x0: 956, y0: 436, x1: 998, y1: 494 },
  { id: 'sky-horizon-left', kind: 'sky', x0: 4, y0: 382, x1: 60, y1: 418 },
  { id: 'sky-horizon-right', kind: 'sky', x0: 1604, y0: 382, x1: 1660, y1: 418 },

  // Surfaces the placeholder scene has: flat ground, path strip, stone faces.
  { id: 'grass-lit', kind: 'ground', x0: 980, y0: 640, x1: 1120, y1: 700 },
  { id: 'grass-mid', kind: 'ground', x0: 1250, y0: 690, x1: 1400, y1: 770 },
  { id: 'grass-shade', kind: 'ground', x0: 300, y0: 852, x1: 452, y1: 918 },
  { id: 'path', kind: 'path', x0: 806, y0: 800, x1: 892, y1: 880 },
  { id: 'stone-lit', kind: 'stone', x0: 902, y0: 168, x1: 940, y1: 240 },
  { id: 'stone-shade', kind: 'stone', x0: 372, y0: 360, x1: 400, y1: 500 },
  { id: 'stone-face', kind: 'stone', x0: 1076, y0: 322, x1: 1168, y1: 398 },

  // The families the read out used to be silent about. Nothing here pulls the
  // grade either, but a number that is never printed is a number nobody checks,
  // and these are four of the seven surfaces the frame is made of.
  { id: 'water-lake-left', kind: 'water', x0: 432, y0: 570, x1: 508, y1: 588 },
  { id: 'water-rivulet', kind: 'water', x0: 812, y0: 660, x1: 856, y1: 700 },
  { id: 'hills-left', kind: 'hills', x0: 40, y0: 440, x1: 190, y1: 468 },
  { id: 'hills-right', kind: 'hills', x0: 1500, y0: 440, x1: 1640, y1: 468 },
  { id: 'rock-crest', kind: 'rock', x0: 1300, y0: 752, x1: 1380, y1: 800 },
  { id: 'rock-moss', kind: 'rock', x0: 1290, y0: 796, x1: 1345, y1: 822 },
];

/** Mean sRGB (0..1) of a rectangle of an 8 bit RGB image. */
export function meanRect(image, rect, scale = 1) {
  const { width, height, data } = image;
  const channels = image.channels || 3;
  const x0 = Math.max(0, Math.round(rect.x0 * scale));
  const x1 = Math.min(width, Math.round(rect.x1 * scale));
  const y0 = Math.max(0, Math.round(rect.y0 * scale));
  const y1 = Math.min(height, Math.round(rect.y1 * scale));
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * width + x) * channels;
      r += data[o]; g += data[o + 1]; b += data[o + 2]; n++;
    }
  }
  if (n === 0) throw new Error(`empty region ${rect.id}`);
  return [r / n / 255, g / n / 255, b / n / 255];
}
