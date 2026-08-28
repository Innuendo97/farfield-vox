import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { FRAME, REPO_ROOT } from './lib/framing.mjs';
import { buildSkyMask, buildStoneMask, TARGET_PATH } from './lib/target.mjs';

// Measures the shading the arrival veil has to carry, by dividing the reference
// by the frame the product draws without it.
//
// The reference is one photograph of one standing place looking one way, and it
// is darker towards its corners than the sky it was a photograph of. Part of
// that the bake divides out and the interface puts back; the rest is what the
// dome cannot carry — the dome is a smooth fitted sky over the whole sphere, and
// the departures the photograph has from that smooth sky belong to the framing,
// not to a bearing. Baked into the dome they would be a dark patch following the
// eye. So they are measured here, in the frame, and hung at the front of it for
// as long as the arrival composition is the one the reference drew.
//
// What that means in practice: this does not fit a law and hope. For every knot
// of a coarse grid over the frame it asks the reference directly — how much of
// the light is left here, compared with what the product draws — and that ratio
// is the answer. The ratios are read on sky, robustly, because sky is the only
// thing in this frame whose value the rest of the project has already agreed on.
//
// Two frames are needed, both at the reference pose, both with the weather held
// (?dev&t0), both at the top tier and full render scale:
//   shots/veil-world.png    the world alone     — veil removed, interface hidden
//   shots/veil-frame.png    the same, interface shown
// The second is only used to find where the interface is, so that its own
// colours never enter the fit. Recipe, in the page:
//   document.querySelector('.sky-veil').remove();
//   document.querySelector('#ui').style.display = 'none';   // then show again
//
// Usage: node tools/grade/fit-veil.mjs [cols] [rows] [smoothness]

const SHOTS = join(REPO_ROOT, 'shots');
const WORLD = process.env.VEIL_WORLD || join(SHOTS, 'veil-world.png');
const FRAME_WITH_UI = process.env.VEIL_FRAME || join(SHOTS, 'veil-frame.png');
const OUT = join(SHOTS, 'veil-field.json');

// How fine the grid is. Wide enough that a cell is a hundred pixels across, so
// nothing in it can be read as a cell; fine enough to follow a corner that falls
// to a quarter of the light over half a frame.
const COLS = Number(process.argv[2] ?? 17);
const ROWS = Number(process.argv[3] ?? 10);

// How much the field is allowed to bend, per unit of misfit. The reference and
// the product do not put their clouds in exactly the same place, and the pixels
// where they disagree ask this field for a cloud-shaped correction. It must not
// give them one: a shading with the shape of the weather in it is the dark
// rectangle the walker already complained about, drawn a second way. Small
// enough that the corner keeps its depth, large enough that a single cell can
// never win an argument on its own.
const SMOOTHNESS = Number(process.argv[4] ?? 0.02);

// The fewest sky pixels a knot needs before its reading counts for anything.
const MIN_SAMPLES = 60;

// The display transfer function, undone once: the veil multiplies an encoded
// value, and this field is a fraction of the light.
const DISPLAY_GAMMA = 2.2;

// A veil takes light away and never adds it, and it never takes more than seven
// eighths: past that it has stopped shading the frame and started painting on it.
const FLOOR = 0.12;

function main() {
  for (const path of [WORLD, FRAME_WITH_UI]) {
    if (!existsSync(path)) throw new Error(`no frame at ${path} — see the recipe at the top of this file`);
  }
  return Promise.all([WORLD, FRAME_WITH_UI, TARGET_PATH]
    .map((p) => sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })))
    .then(async ([world, framed, reference]) => {
      const { width: W, height: H } = FRAME;
      for (const [name, img] of [['world', world], ['frame', framed], ['reference', reference]]) {
        if (img.info.width !== W || img.info.height !== H) {
          throw new Error(`${name} is ${img.info.width}x${img.info.height}, the reference framing is ${W}x${H}`);
        }
      }

      const sky = await buildSkyMask();
      const stone = await buildStoneMask();
      for (let i = 0; i < sky.length; i++) if (stone[i]) sky[i] = 0;

      const luma = (d, o) => 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2];
      // The interface is wherever showing it changed a pixel. Its own colours are
      // not the sky's and have no business steering a shading of the sky.
      const isInterface = (o) => world.data[o] !== framed.data[o]
        || world.data[o + 1] !== framed.data[o + 1] || world.data[o + 2] !== framed.data[o + 2];

      const cellW = W / (COLS - 1);
      const cellH = H / (ROWS - 1);
      const bags = Array.from({ length: ROWS * COLS }, () => []);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (!sky[i]) continue;
          const o = i * 4;
          if (isInterface(o)) continue;
          const drawn = luma(world.data, o);
          const wanted = luma(reference.data, o);
          // Both sides far enough from the ends of the scale that a ratio of
          // eight bit values is a ratio of light and not of two clippings.
          if (drawn < 30 || drawn > 248 || wanted < 10 || wanted > 248) continue;
          bags[Math.round(y / cellH) * COLS + Math.round(x / cellW)].push((wanted / drawn) ** DISPLAY_GAMMA);
        }
      }
      const median = (list) => {
        const sorted = list.slice().sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
      };
      const observed = bags.map((bag) => (bag.length >= MIN_SAMPLES ? median(bag) : null));
      // A knot read off three thousand pixels is worth holding against the
      // smoothness; one read off eighty is worth much less.
      const weight = bags.map((bag) => (bag.length >= MIN_SAMPLES ? Math.min(1, bag.length / 3000) : 0));

      // Where the reference shows no sky at all — behind its monoliths, below its
      // horizon — there is nothing to read and the field is whatever its
      // neighbours make it. That is not a gap: a shading belongs to the framing,
      // and the framing is there whether or not something is standing in it.
      const field = observed.map((v) => (v === null ? 0.95 : v));
      const at = (i, j) => field[j * COLS + i];
      for (let pass = 0; pass < 6000; pass++) {
        for (let j = 0; j < ROWS; j++) {
          for (let i = 0; i < COLS; i++) {
            const k = j * COLS + i;
            const around = [];
            if (i > 0) around.push(at(i - 1, j));
            if (i < COLS - 1) around.push(at(i + 1, j));
            if (j > 0) around.push(at(i, j - 1));
            if (j < ROWS - 1) around.push(at(i, j + 1));
            const sum = around.reduce((a, b) => a + b, 0);
            field[k] = (weight[k] * (observed[k] ?? 0) + SMOOTHNESS * sum)
              / (weight[k] + SMOOTHNESS * around.length);
          }
        }
      }
      for (let k = 0; k < field.length; k++) field[k] = Math.max(FLOOR, Math.min(1, field[k]));

      const values = field.map((v) => Number(v.toFixed(4)));
      writeFileSync(OUT, `${JSON.stringify({ cols: COLS, rows: ROWS, values })}\n`, 'utf8');

      const read = observed.filter((v) => v !== null).length;
      process.stdout.write(`arrival shading, ${COLS} x ${ROWS} knots, ${read} of ${ROWS * COLS} read from the reference\n`);
      process.stdout.write(`smoothness ${SMOOTHNESS}, floor ${FLOOR}, corners `
        + `${values[0].toFixed(3)} ${values[COLS - 1].toFixed(3)} `
        + `${values[(ROWS - 1) * COLS].toFixed(3)} ${values[ROWS * COLS - 1].toFixed(3)}\n`);
      for (let j = 0; j < ROWS; j++) {
        process.stdout.write('  ' + Array.from({ length: COLS }, (_, i) => {
          const k = j * COLS + i;
          return (observed[k] === null ? `(${values[k].toFixed(2)})` : ` ${values[k].toFixed(2)} `).padStart(7);
        }).join('') + '\n');
      }
      process.stdout.write(`${OUT}\n`);
      process.stdout.write('paste values into ARRIVAL_SHADING in tools/grade/lib/shading.mjs, '
        + 'then re-run the sky bake so sky.json carries it\n');
    });
}

main();
