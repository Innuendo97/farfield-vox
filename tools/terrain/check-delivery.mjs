import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../grade/lib/framing.mjs';

// IS WHAT THE WORLD DRAWS THE MAP THAT WAS JUST BAKED?
//
//   node tools/terrain/check-delivery.mjs
//   node tools/terrain/check-delivery.mjs --pretend-stale
//
// A bake writes a PNG into assets-src. The browser never reads that PNG: it
// reads a KTX2 in public/assets that "npm run assets:build" makes from it. The
// two are separate steps and nothing between them was checking that the second
// had been run.
//
// IT HAD NOT BEEN, and it cost the client a defect report. The ground light map
// was re-baked the right way up at 1884bde and the shipped KTX2 was left at the
// version built four commits earlier, from the MIRRORED map. For four commits
// the world was lit by a mirror image of itself while every guard in the chain
// said it was fine — because every guard reads the source. What the client saw
// was a hard black quadrilateral lying on open meadow east of the path: the
// platform's own fully occluded footprint, folded north to south onto grass.
//
// It is not a defect an eye catches as a wrong winding. A mirrored world is
// still a world with shading on it. What gives it away is a piece of ground
// that is black where nothing stands, and by then it is in front of the client.
//
// So the question is asked here, after every bake, of the DELIVERY and not of
// the source. It compares the two by modification time, which is exactly the
// shape of this failure — a source rebuilt and a delivery left behind — and it
// is honest about what that cannot catch: a file touched without being rebuilt
// passes, and a fresh checkout gives both the same time and passes too, which is
// correct because a checkout delivers the two together.

const PAIRS = [
  ['assets-src/terrain/terrain-albedo.png', 'public/assets/textures/terrain-albedo.ktx2'],
  ['assets-src/terrain/terrain-light.png', 'public/assets/textures/terrain-light.ktx2'],
  ['assets-src/terrain/terrain-path.png', 'public/assets/textures/terrain-path.ktx2'],
  ['assets-src/terrain/stairs-albedo.png', 'public/assets/textures/stairs-albedo.ktx2'],
  ['assets-src/terrain/stairs-light.png', 'public/assets/textures/stairs-light.ktx2'],
  ['assets-src/monoliths/monolith-light.png', 'public/assets/textures/monolith-light.ktx2'],
  ['assets-src/rocks/rock-light.png', 'public/assets/textures/rock-light.ktx2'],
  ['assets-src/vegetation/grass-atlas.png', 'public/assets/textures/grass-atlas.ktx2'],
  ['assets-src/vegetation/props-atlas.png', 'public/assets/textures/props-atlas.ktx2'],
];

// A second of slack, because a build that finishes inside the same second as the
// source it read is not a stale build.
const SLACK_MS = 1000;
const PRETEND = process.argv.includes('--pretend-stale');
// A bake LEAVES the delivery stale — that is what a bake does — so standing at
// the end of the bake this reports and does not refuse. It refuses everywhere
// else, which is where a stale delivery is a defect rather than a step not
// taken yet.
const AFTER_BAKE = process.argv.includes('--after-bake');

const stale = [];
const missing = [];
const checked = [];
for (const [source, shipped] of PAIRS) {
  const srcPath = join(REPO_ROOT, source);
  const outPath = join(REPO_ROOT, shipped);
  if (!existsSync(srcPath)) continue;
  if (!existsSync(outPath)) { missing.push(shipped); continue; }
  const src = statSync(srcPath).mtimeMs;
  const out = statSync(outPath).mtimeMs + (PRETEND ? -1e9 : 0);
  checked.push({ source, shipped, behind: (src - out) / 1000 });
  if (src - out > SLACK_MS) stale.push({ source, shipped, behind: (src - out) / 1000 });
}

process.stdout.write('IS THE DELIVERY THE MAP THAT WAS BAKED?\n');
for (const row of checked) {
  process.stdout.write(`  ${row.shipped.padEnd(48)}`
    + `${row.behind > SLACK_MS / 1000 ? `${row.behind.toFixed(0)} s BEHIND its source`
      : 'newer than its source'}\n`);
}
if (missing.length) {
  process.stdout.write(`\n${missing.length} shipped file(s) do not exist at all:\n`);
  for (const m of missing) process.stdout.write(`  ${m}\n`);
}

if (stale.length || missing.length) {
  process.stdout.write(`\n${stale.length + missing.length} of ${PAIRS.length} deliveries are `
    + 'older than the source they are made from. The browser reads the delivery, so what\n'
    + 'the world draws is not what was just baked.\n');
  process.stdout.write('  run: npm run assets:build\n');
  if (AFTER_BAKE && !PRETEND) {
    process.stdout.write('  (not a failure here: a bake is supposed to leave this behind. '
      + 'It IS a failure anywhere else.)\n');
    process.exit(0);
  }
  if (PRETEND) {
    process.stdout.write('\nVALIDATION OK: with the defect present the check refuses. '
      + 'The measurement finds the defect it was written for.\n');
    process.exit(0);
  }
  process.exit(1);
}

if (PRETEND) {
  process.stdout.write('\nVALIDATION FAILED: the pretend-stale run was supposed to be refused.\n');
  process.exit(1);
}
process.stdout.write(`\nall ${checked.length} deliveries are at least as new as their sources.\n`);
