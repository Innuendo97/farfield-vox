import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { FRAME, REPO_ROOT } from '../grade/lib/framing.mjs';
import { deltaE2000, deltaE76, srgbToLab } from '../grade/lib/color.mjs';
import { meanRect, readTarget } from '../grade/lib/target.mjs';
import { PATCHES } from './sample-target.mjs';

// Measures a render of the reference pose against the reference itself, on the
// ground patches only.
//
// The eye decides whether this is right, but the eye cannot tell eight units of
// error from fourteen, and that is exactly the range this step lives in. So
// every round is also read numerically, over the same rectangles the albedo was
// authored from.

const DEFAULT = join(REPO_ROOT, 'shots', 'pose-p.png');

async function readRender(path) {
  const { data, info } = await sharp(path).removeAlpha()
    .resize(FRAME.width, FRAME.height, { fit: 'fill' }).raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, channels: 3, data };
}

const hex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)
  .toString(16).padStart(2, '0')).join('')}`;

async function main() {
  const path = process.argv[2] || DEFAULT;
  if (!existsSync(path)) throw new Error(`no render at ${path}`);

  const render = await readRender(path);
  const target = await readTarget();
  const only = process.argv.find((a) => a.startsWith('--kind='))?.slice(7);

  const rows = [];
  for (const patch of PATCHES) {
    if (only && patch.kind !== only) continue;
    const from = meanRect(render, patch);
    const to = meanRect(target, patch);
    rows.push({
      id: patch.id,
      kind: patch.kind,
      from,
      to,
      e76: deltaE76(srgbToLab(from), srgbToLab(to)),
      e2000: deltaE2000(srgbToLab(from), srgbToLab(to)),
    });
  }

  process.stdout.write(`${path}\n\n`);
  process.stdout.write(`  ${'patch'.padEnd(20)}${'kind'.padEnd(7)}`
    + `${'render'.padEnd(10)}${'target'.padEnd(10)}${'dE76'.padStart(7)}${'dE2000'.padStart(8)}\n`);
  for (const row of rows) {
    process.stdout.write(`  ${row.id.padEnd(20)}${row.kind.padEnd(7)}`
      + `${hex(row.from).padEnd(10)}${hex(row.to).padEnd(10)}`
      + `${row.e76.toFixed(2).padStart(7)}${row.e2000.toFixed(2).padStart(8)}\n`);
  }

  const byKind = new Map();
  for (const row of rows) {
    if (!byKind.has(row.kind)) byKind.set(row.kind, []);
    byKind.get(row.kind).push(row.e76);
  }
  process.stdout.write('\n');
  for (const [kind, values] of byKind) {
    const mean = values.reduce((t, v) => t + v, 0) / values.length;
    process.stdout.write(`  mean ${kind.padEnd(12)}${mean.toFixed(2).padStart(7)} dE76\n`);
  }
  const all = rows.reduce((t, r) => t + r.e76, 0) / rows.length;
  process.stdout.write(`  mean ${'overall'.padEnd(12)}${all.toFixed(2).padStart(7)} dE76\n`);
}

main();
