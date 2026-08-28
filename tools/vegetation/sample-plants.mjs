import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRAME, makeRay, REPO_ROOT } from '../grade/lib/framing.mjs';
import { meanRect, readTarget } from '../grade/lib/target.mjs';
import { loadGround, solveRadiance, traceGround } from '../terrain/probe.mjs';
import { castShadowTest } from '../lighting/cast-shadow.mjs';
import { sampleGroundLight } from './lib/ground.mjs';

// Reads the grass, the flowers and the rock out of the reference image.
//
// Nothing in the vegetation may be coloured by taste. The cards stand on the
// meadow and are multiplied by the meadow's own light, so a pigment that was
// picked rather than solved reads as a carpet of a different green laid over the
// ground, and no amount of tuning at draw time takes that back out.
//
// The chain is the one the ground was authored with, run backwards. A rectangle
// of the reference is inverted through the whole composite — grade, lens
// shading and tone curve together, numerically, because none of the three has an
// inverse in closed form — which gives the radiance the frame has to carry
// there. That is then divided by the light the Cycles bake actually puts on the
// ground behind those pixels. What is left is reflectance, which is the only
// thing an albedo is allowed to be.

const OUT_DIR = join(REPO_ROOT, 'assets-src', 'vegetation');

// Patches of the reference, in pixels of the 1672x941 framing.
//
// "surface" says what the patch stands on. A patch on a rock has no place in
// the ground's light atlas, so the light under it is read from the grass at its
// foot, which stands under the same open sky. "high" takes the brightest tail
// of the rectangle instead of its mean: it is the only way to measure a flower
// two pixels across without averaging in the leaves around it.
export const PATCHES = [
  // The meadow, from the lit band under the blocks down to the shaded
  // foreground. The tuft has to agree with these four or it will not belong to
  // the ground it stands on.
  { id: 'grass-lit-band', kind: 'grass', surface: 'ground', x0: 1180, y0: 690, x1: 1330, y1: 730 },
  { id: 'grass-lit-near', kind: 'grass', surface: 'ground', x0: 1200, y0: 760, x1: 1340, y1: 800 },
  { id: 'grass-shade-near', kind: 'grass', surface: 'ground', x0: 300, y0: 800, x1: 460, y1: 870 },
  { id: 'grass-deep-low', kind: 'grass', surface: 'ground', x0: 1180, y0: 880, x1: 1380, y1: 936 },
  // The lit crown of a tuft, against the mean of the grass around it. This
  // ratio is what the blade tips are painted with.
  { id: 'grass-crown', kind: 'grass', surface: 'ground', high: 0.02, x0: 1150, y0: 700, x1: 1400, y1: 790 },
  // The white flowers: the brightest half per cent of a patch of meadow that is
  // full of them, because that is what a flower is in this image.
  { id: 'flower-white', kind: 'flower', surface: 'ground', high: 0.005, x0: 1180, y0: 700, x1: 1460, y1: 800 },
  { id: 'flower-shade', kind: 'flower', surface: 'ground', high: 0.01, x0: 260, y0: 760, x1: 520, y1: 860 },

  // The hero rocks in the bottom right corner: the lit crown of the big one is
  // weathered stone catching the sun, the moss is the olive on its shoulder.
  { id: 'rock-lit-crown', kind: 'rock', surface: 'rock', x0: 1330, y0: 772, x1: 1420, y1: 806 },
  { id: 'rock-lit-right', kind: 'rock', surface: 'rock', x0: 1455, y0: 795, x1: 1530, y1: 820 },
  { id: 'rock-moss-rim', kind: 'moss', surface: 'rock', x0: 1290, y0: 796, x1: 1345, y1: 822 },
  { id: 'rock-moss-top', kind: 'moss', surface: 'rock', x0: 1436, y0: 800, x1: 1500, y1: 828 },
  { id: 'rock-shade-face', kind: 'rock', surface: 'rock', x0: 1300, y0: 830, x1: 1400, y1: 870 },
  // The mass in the bottom left corner, which the reference leaves almost in
  // silhouette.
  { id: 'rock-left-dark', kind: 'rock', surface: 'rock', x0: 40, y0: 850, x1: 180, y1: 920 },

  // The low bushes between the blocks: dark, cool, barely broken up.
  { id: 'bush-behind-01', kind: 'bush', surface: 'ground', x0: 470, y0: 596, x1: 540, y1: 624 },
];

/** Mean of the brightest fraction of a rectangle, in sRGB. */
function meanBrightest(image, rect, fraction) {
  const { width, data } = image;
  const rows = [];
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const o = (y * width + x) * 3;
      rows.push([data[o], data[o + 1], data[o + 2]]);
    }
  }
  rows.sort((a, b) => (b[0] + b[1] + b[2]) - (a[0] + a[1] + a[2]));
  const take = Math.max(1, Math.round(rows.length * fraction));
  const sum = [0, 0, 0];
  for (let i = 0; i < take; i++) for (let c = 0; c < 3; c++) sum[c] += rows[i][c];
  return sum.map((v) => v / take / 255);
}

const hex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)
  .toString(16).padStart(2, '0')).join('')}`;

const round = (values, digits = 4) => values.map((v) => Number(v.toFixed(digits)));

const occluded = castShadowTest({ withBuilt: true });

// Mean light over the meadow the sun does reach, at a given distance from the
// eye. Cached: it costs a sweep of the framing and every shadowed patch wants
// the same answer.
const openBands = new Map();
function openLightAt(ground, ray, distance) {
  const band = Math.round(distance / 3);
  if (!openBands.has(band)) {
    const sum = [0, 0, 0];
    let n = 0;
    for (let py = 600; py < FRAME.height; py += 5) {
      for (let px = 0; px < FRAME.width; px += 5) {
        const hit = traceGround(ray(px, py));
        if (!hit || Math.round(hit.distance / 3) !== band) continue;
        if (occluded(hit.x, hit.y + 0.02, hit.z)) continue;
        const light = sampleGroundLight(ground, hit.x, hit.z);
        for (let c = 0; c < 3; c++) sum[c] += light[c];
        n++;
      }
    }
    openBands.set(band, n ? sum.map((v) => v / n) : null);
  }
  return openBands.get(band) || [1, 1, 1];
}

async function main() {
  const target = await readTarget();
  const ground = await loadGround();
  const ray = makeRay();
  const rows = [];

  for (const patch of PATCHES) {
    const srgb = patch.high
      ? meanBrightest(target, patch, patch.high)
      : meanRect(target, patch);

    const cx = Math.round((patch.x0 + patch.x1) / 2);
    const cy = Math.round((patch.y0 + patch.y1) / 2);
    const solved = solveRadiance(srgb, cx, cy, ground.lut);

    // The row below the rectangle for a rock, which is the grass at its foot.
    const probeY = patch.surface === 'rock' ? Math.min(FRAME.height - 1, patch.y1 + 12) : cy;
    const hit = traceGround(ray(cx, probeY));
    // AND WHERE THE REFERENCE CONTRADICTS THE SEALED SUN, THE LIGHT IS
    // SUBSTITUTED RATHER THAN USED.
    //
    // The committente chose pure physics: the sun of S1 casts real shadows, and
    // the photograph does not have them — it is two to five times brighter
    // inside them. A reflectance solved there is the reference's radiance over
    // this world's shadow, which is not a reflectance at all: it came back at
    // 6.1, 6.8 and 12.9, and an albedo over one is a surface that makes light.
    //
    // So for a patch standing in a cast shadow the light is taken from OPEN
    // ground at the same distance instead. It is a declared substitution and not
    // a repair: what it says is "this pigment is solved against the light this
    // world gives comparable open meadow", which is the only honest reading left
    // once the picture and the sun have been allowed to disagree.
    const shadowed = hit ? occluded(hit.x, hit.y + 0.02, hit.z) : false;
    const light = hit
      ? (shadowed ? openLightAt(ground, ray, hit.distance) : sampleGroundLight(ground, hit.x, hit.z))
      : [1, 1, 1];
    const albedo = solved.radiance.map((c, i) => c / Math.max(light[i], 1e-4));

    rows.push({
      id: patch.id,
      kind: patch.kind,
      rect: [patch.x0, patch.y0, patch.x1, patch.y1],
      hex: hex(srgb),
      world: hit ? round([hit.x, hit.z, hit.distance], 2) : null,
      radiance: round(solved.radiance),
      inversionError: Number(solved.error.toFixed(4)),
      light: round(light),
      albedo: round(albedo),
    });
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const palette = { frame: FRAME, patches: rows };
  writeFileSync(join(OUT_DIR, 'palette.json'), `${JSON.stringify(palette, null, 2)}\n`, 'utf8');

  process.stdout.write(`  ${'patch'.padEnd(18)}${'kind'.padEnd(8)}${'hex'.padEnd(10)}`
    + `${'dist'.padStart(7)}${'  light'.padEnd(26)}albedo\n`);
  for (const row of rows) {
    process.stdout.write(`  ${row.id.padEnd(18)}${row.kind.padEnd(8)}${row.hex.padEnd(10)}`
      + `${(row.world ? row.world[2].toFixed(1) : '-').padStart(7)}  `
      + `${row.light.map((v) => v.toFixed(3).padStart(8)).join('')}  `
      + `${row.albedo.map((v) => v.toFixed(4).padStart(8)).join('')}\n`);
  }
  // A reflectance over one is a surface that makes light, and it has to be said
  // out loud rather than left in a table. The two "high" patches are exempt:
  // they are the brightest tail of a rectangle and are consumed as RATIOS
  // against the mean beside them, not as reflectances.
  const impossible = rows.filter((r) => !PATCHES.find((p) => p.id === r.id).high
    && r.albedo.some((v) => v > 1));
  if (impossible.length) {
    process.stdout.write('\nOVER ONE, which no reflectance may be:\n');
    for (const row of impossible) {
      process.stdout.write(`  ${row.id.padEnd(18)}${row.albedo.map((v) => v.toFixed(3)
        .padStart(8)).join('')}\n`);
    }
    process.stdout.write('  This is the two lights disagreeing, in one number: the reference\n'
      + '  carries more radiance there than the sealed sun and the dome can put on any\n'
      + '  surface. Not clamped, because a clamp would hide it.\n');
  }

  process.stdout.write(`\npalette: ${join(OUT_DIR, 'palette.json')}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('sample-plants.mjs')) await main();
