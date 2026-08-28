import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { formatBytes, loadToolchain, REPO_ROOT, run } from './toolchain.mjs';

// Turns the sources in assets-src/ into what public/assets/ serves: binary
// glTF with meshopt geometry and KTX2 textures. Output shape and first frame
// budget are declared in assets-src/assets.d/ and republished into
// public/assets/manifest.json, which is what the runtime actually reads.
//
// WHY THE SOURCE MANIFEST IS IN PIECES. It was one file, and one file that
// every session has to add a line to is a file every session collides in --
// eight branches, one list, and a merge conflict on the delivery for anybody
// who so much as renames a texture. Now each session owns a fragment named
// after it, and this concatenates them.
//
// THE ORDER IS THE FILENAME'S, sorted, and it is stated rather than incidental:
// a build that shuffles its own manifest between runs is a build whose output
// cannot be compared with the last one. The layer ids sort in their own order
// already (v1 before v2 before v4), and comune.json sorts before all of them.

const SRC_DIR = join(REPO_ROOT, 'assets-src');
const OUT_DIR = join(REPO_ROOT, 'public', 'assets');
const SOURCE_DIR = join(SRC_DIR, 'assets.d');
const OUT_MANIFEST = join(OUT_DIR, 'manifest.json');
const CACHE_FILE = join(REPO_ROOT, 'tools', 'bin', '.cache', 'assets-build.json');
const TEMP_DIR = join(REPO_ROOT, 'tools', 'bin', '.cache', 'assets-temp');
const CLI = join(REPO_ROOT, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');

// UASTC for what the player can walk up to, ETC1S for baked light: this is the
// split that keeps VRAM at a quarter without visible artefacts on the surfaces
// that are read from close range.
const TEXTURE_PROFILES = {
  albedo: {
    encoder: 'uastc',
    ktx: ['--format', 'R8G8B8A8_SRGB', '--assign-tf', 'srgb', '--encode', 'uastc', '--uastc-quality', '2', '--zstd', '18'],
    gltf: ['--level', '2', '--rdo', 'true', '--rdo-lambda', '1', '--zstd', '18'],
  },
  // Three channels, kept as three. The encoder's normal mode packs a normal map
  // into two channels and leaves the third to be reconstructed by whoever reads
  // it; nothing in this renderer does that reconstruction, so what came back was
  // one channel repeated across the other two, and the stone was drawn covered
  // in vertical scratches. The gain in size was a few tens of kilobytes.
  normal: {
    encoder: 'uastc',
    ktx: ['--format', 'R8G8B8A8_UNORM', '--encode', 'uastc', '--uastc-quality', '2',
      '--assign-tf', 'linear', '--zstd', '18'],
    gltf: ['--level', '2', '--rdo', 'true', '--rdo-lambda', '0.5', '--zstd', '18'],
  },
  // The sky is the one surface with nothing to hide banding behind: a smooth
  // gradient over the whole frame. It gets UASTC at the highest quality the
  // encoder offers, never ETC1S, and no rate optimiser.
  //
  // There used to be a second profile beside this one that traded quality for
  // rate, and it existed because the sky was dithered in the bake. UASTC is a
  // fixed rate codec — eight bits a texel whatever the picture — so the whole
  // saving has to come out of how well the blocks then compress, and dithered
  // blocks compress barely at all. With the dither moved into the fragment
  // shader there is nothing left to trade: measured on this sky, the optimiser
  // saves a hundred kilobytes on three hundred and costs the picture a third of
  // a level of error, and a third of a level is exactly the sort of error a
  // gradient shows.
  sky: {
    encoder: 'uastc',
    ktx: ['--format', 'R8G8B8A8_SRGB', '--assign-tf', 'srgb', '--encode', 'uastc', '--uastc-quality', '4', '--zstd', '18'],
    gltf: ['--level', '4', '--rdo', 'false', '--zstd', '18'],
  },
  // The cloud sprites: colour premultiplied by coverage in three channels and
  // the coverage in the fourth.
  //
  // Never ETC1S, and the reason is the fourth channel. That codec carries alpha
  // as a second, coarser image and quantises it hard; what a cumulus has in its
  // alpha is the backlit rim — a gradient a few texels wide that is the whole
  // drama of this sky — and it comes back from ETC1S as a staircase. Measured on
  // this very atlas the saving would be two thirds of the file, and it is not
  // for sale. No rate optimiser either: it works by making blocks resemble one
  // another, and the blocks of a cloud edge are the ones that must not.
  cloud: {
    encoder: 'uastc',
    ktx: ['--format', 'R8G8B8A8_SRGB', '--assign-tf', 'srgb', '--encode', 'uastc',
      '--uastc-quality', '2', '--zstd', '22'],
    gltf: ['--level', '2', '--rdo', 'false', '--zstd', '22'],
  },
  // The cloud coverage, and it does not go through a block codec at all.
  //
  // WHAT A BLOCK CODEC CANNOT HOLD IS A BLOCK THAT IS PART CLOUD AND PART
  // NOTHING. The sprite atlas is premultiplied, so where there is no cloud there
  // is nothing — colour nought and coverage nought — and the material discards a
  // fragment whose coverage is nought. Measured on the delivered atlas, by
  // decoding it back and comparing its coverage against the source: UASTC lifts
  // 20 697 texels of clear sky inside the windows above zero, up to 22 of 255,
  // and pushes 2.16 per cent of solid body below 252. Every lifted texel is a
  // fragment the frame now blends, in squares four texels across, over open
  // blue — which is the staircase the committente named, and the holes are the
  // same defect the other way round.
  //
  // AND IT IS NOT AN ENCODER SETTING. The same atlas at the highest quality the
  // codec offers costs six kilobytes more and moves the coverage error on the
  // fringe from RMS 2.572 to 2.495 and the block step from 1.129 to 1.130: the
  // error belongs to eight bits a texel spent on four channels, not to the
  // search. The whole atlas without a block codec is exact and costs 5.44 MB,
  // which the sky budget does not have.
  //
  // So the coverage travels alone, one channel, uncompressed, zstd only: 887 KB
  // against the 1.90 MB the pair costs today, and exact. The colour keeps the
  // block codec and gets every bit of it, because its fourth channel is now
  // free. NEVER sRGB: a coverage is a fraction and not a picture, and a texture
  // with a transfer comes back from the sampler decoded.
  //
  // AND A COVERAGE MAY CARRY MORE THAN ONE FIELD. Everything above is about how
  // a fraction of a fragment has to travel, and none of it is about how many
  // fractions there are; an entry that needs two says so with `channels` and
  // gets the two channel format of the same family. It is stated on the entry
  // rather than minted as a second role because a role is what the runtime reads
  // to decide the transfer function and the filter (src/core/assets.js), and
  // those answers do not change with the count.
  coverage: {
    encoder: 'uastc',
    ktx: ['--format', 'R8_UNORM', '--assign-tf', 'linear', '--zstd', '22'],
    gltf: ['--level', '2', '--rdo', 'false', '--zstd', '22'],
    byChannels: { 1: 'R8_UNORM', 2: 'R8G8_UNORM' },
  },
  // The generated cloud atlas: not a picture at all.
  //
  // Its three and four channels are the log-domain maps a piece's illumination
  // is rebuilt from, and its fourth channel on the first texture is coverage.
  // NOTHING here may be tagged sRGB. A texture with a transfer comes back from
  // the sampler decoded, and a decoded coefficient is a different number from
  // the one the packing wrote: the reconstruction would be of some other cloud,
  // silently and everywhere. src/world/cloud-relight.js states the same
  // requirement from the reading end.
  //
  // UASTC and no rate optimiser, for the same reason the sprites get them:
  // four uncorrelated scalars in an RGBA block are not what a codec that spends
  // its bits on a line through colour space is good at, and an optimiser that
  // works by making blocks resemble one another is the last thing wanted where
  // the blocks are a silhouette.
  data: {
    encoder: 'uastc',
    ktx: ['--format', 'R8G8B8A8_UNORM', '--assign-tf', 'linear', '--encode', 'uastc',
      '--uastc-quality', '2', '--zstd', '22'],
    gltf: ['--level', '2', '--rdo', 'false', '--zstd', '22'],
  },
  lightmap: {
    encoder: 'etc1s',
    ktx: ['--format', 'R8G8B8A8_SRGB', '--assign-tf', 'srgb', '--encode', 'basis-lz', '--clevel', '4', '--qlevel', '160'],
    gltf: ['--compression', '4', '--quality', '160'],
  },
};

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
}

/**
 * The source manifest, concatenated out of the fragments in assets-src/assets.d.
 *
 * Deterministic by filename, and strict about the two ways the pieces can
 * disagree with each other -- because those are exactly the failures that only
 * show up once two sessions have merged, which is far too late:
 *
 *   two fragments claiming the same id  -- one of them would silently win, and
 *                                          which one would depend on a sort
 *   no fragment, or two, declaring the budget -- the budget is the whole
 *                                          world's and belongs to one seat
 */
function readSourceManifest() {
  if (!existsSync(SOURCE_DIR)) {
    throw new Error(`missing source manifest directory: ${SOURCE_DIR}`);
  }
  const files = readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`no fragments in ${SOURCE_DIR}`);

  const assets = [];
  const seen = new Map();
  let budget = null;
  let budgetFrom = null;
  for (const file of files) {
    const fragment = readJson(join(SOURCE_DIR, file));
    if (fragment.budget) {
      if (budget) {
        throw new Error(`two fragments declare a budget: ${budgetFrom} and ${file}`);
      }
      budget = fragment.budget;
      budgetFrom = file;
    }
    for (const entry of fragment.assets || []) {
      if (seen.has(entry.id)) {
        throw new Error(`"${entry.id}" is declared twice: ${seen.get(entry.id)} and ${file}`);
      }
      seen.set(entry.id, file);
      assets.push(entry);
    }
  }
  if (!budget) throw new Error(`no fragment in ${SOURCE_DIR} declares a budget`);
  return { budget, assets, fragments: files };
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
}

function loadCache() {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    return readJson(CACHE_FILE);
  } catch {
    return {};
  }
}

function ktxEnv() {
  // The glTF CLI texture commands look for "ktx" on PATH: the locally installed
  // one goes first, so the build never depends on what the machine has.
  const toolchain = loadToolchain();
  const ktxDir = dirname(toolchain.ktx.exe);
  return { ...process.env, PATH: `${ktxDir};${process.env.PATH}` };
}

function gltf(args, env) {
  run(process.execPath, [CLI, ...args], { env });
}

function buildModel(entry, srcPath, outPath, env) {
  mkdirSync(TEMP_DIR, { recursive: true });
  const stage = (n) => join(TEMP_DIR, `${entry.id}.${n}.glb`);
  let current = srcPath;

  gltf(['dedup', current, stage(1)], env);
  // Vertex attributes are kept even when nothing in the file appears to use
  // them. The scene code builds its own materials, so a mesh arrives here with
  // texture coordinates no glTF material refers to: pruning them leaves a
  // lightmapped surface with nowhere to read its light from.
  gltf(['prune', stage(1), stage(2), '--keep-attributes', 'true'], env);
  gltf(['weld', stage(2), stage(3)], env);
  current = stage(3);

  // Textures inside a model are encoded slot by slot, because a normal map and
  // a lightmap do not survive the same codec.
  const slotsByRole = new Map();
  for (const [slot, role] of Object.entries(entry.textures || {})) {
    if (!TEXTURE_PROFILES[role]) throw new Error(`unknown texture role: ${role}`);
    if (!slotsByRole.has(role)) slotsByRole.set(role, []);
    slotsByRole.get(role).push(slot);
  }
  let step = 4;
  for (const [role, slots] of slotsByRole) {
    const profile = TEXTURE_PROFILES[role];
    // A single element brace is not expanded by the CLI matcher and would end
    // up silently selecting nothing.
    const pattern = slots.length === 1 ? slots[0] : `{${slots.join(',')}}`;
    gltf([profile.encoder, current, stage(step), '--slots', pattern, ...profile.gltf], env);
    current = stage(step);
    step += 1;
  }

  gltf(['meshopt', current, outPath, '--level', 'high'], env);
}

// Resampling filter for entries that declare a size of their own. Lanczos over
// four lobes rather than the encoder's default: a sky reduced with a box filter
// keeps the dither as noise instead of averaging it away, and the noise is what
// the block codec then has to spend its bits on.
const RESAMPLE_FILTER = 'lanczos4';

function buildTexture(entry, srcPath, outPath, env) {
  const profile = TEXTURE_PROFILES[entry.role || 'albedo'];
  if (!profile) throw new Error(`unknown texture role: ${entry.role}`);
  const toolchain = loadToolchain();
  // A declared size means the source is larger than what this entry ships, and
  // the encoder does the reduction: one source on disk, one picture, several
  // sizes of it, and no intermediate file that could drift from either.
  const resize = entry.size
    ? ['--width', String(entry.size.width), '--height', String(entry.size.height),
      '--mipmap-filter', RESAMPLE_FILTER]
    : [];
  // How many fields the entry ships, when its role can carry more than one. The
  // source PNG is always a colour image — the encoder reads a grey-with-alpha
  // file as grey and drops the alpha, measured — so what decides is this and not
  // what the file happens to hold.
  const ktx = [...profile.ktx];
  if (entry.channels) {
    const format = (profile.byChannels || {})[entry.channels];
    const at = ktx.indexOf('--format');
    if (!format || at < 0) {
      throw new Error(`"${entry.id}" asks for ${entry.channels} channels, `
        + `which the role "${entry.role}" does not offer`);
    }
    ktx[at + 1] = format;
  }
  run(toolchain.ktx.exe, [
    'create',
    '--generate-mipmap',
    ...resize,
    ...ktx,
    srcPath,
    outPath,
  ], { env });
}

function main() {
  const source = readSourceManifest();
  // The concatenation on its own, and nothing built. What it is FOR is proving
  // that a change to how the pieces are put together did not change what they
  // come to -- which is a question about a JSON document and must never require
  // an encoder, a delivery, or half an hour.
  //
  //   node tools/build-assets.mjs --dry-run
  if (process.argv.includes('--dry-run')) {
    process.stdout.write(`${JSON.stringify(
      { budget: source.budget, assets: source.assets }, null, 2,
    )}
`);
    return;
  }
  process.stdout.write(`manifest: ${source.fragments.join(' + ')}
`);
  const env = ktxEnv();
  const cache = loadCache();
  const nextCache = {};
  const force = process.argv.includes('--force');

  mkdirSync(OUT_DIR, { recursive: true });

  const built = [];
  for (const entry of source.assets) {
    const srcPath = join(SRC_DIR, entry.source);
    if (!existsSync(srcPath)) {
      throw new Error(`missing source for "${entry.id}": ${srcPath}`);
    }
    // A table travels as itself. There is nothing to encode in a list of
    // coefficients, and putting one through a codec would be a way of losing
    // digits the shader multiplies by.
    const ext = { model: 'glb', json: 'json' }[entry.type] || 'ktx2';
    const folder = { model: 'models', json: 'data' }[entry.type] || 'textures';
    const outPath = join(OUT_DIR, folder, `${entry.id}.${ext}`);
    mkdirSync(dirname(outPath), { recursive: true });

    const fingerprint = createHash('sha256')
      .update(hashFile(srcPath))
      .update(JSON.stringify(entry))
      .update(JSON.stringify(TEXTURE_PROFILES))
      .digest('hex')
      .slice(0, 16);
    nextCache[entry.id] = fingerprint;

    if (!force && cache[entry.id] === fingerprint && existsSync(outPath)) {
      process.stdout.write(`= ${entry.id} (unchanged)\n`);
    } else {
      process.stdout.write(`> ${entry.id} ${basename(srcPath)}\n`);
      const started = Date.now();
      if (entry.type === 'model') buildModel(entry, srcPath, outPath, env);
      else if (entry.type === 'json') copyFileSync(srcPath, outPath);
      else buildTexture(entry, srcPath, outPath, env);
      process.stdout.write(`  ${((Date.now() - started) / 1000).toFixed(2)} s\n`);
    }

    const bytes = statSync(outPath).size;
    const sourceBytes = statSync(srcPath).size;
    built.push({
      id: entry.id,
      type: entry.type,
      role: entry.role || null,
      priority: entry.priority || 'deferred',
      scope: entry.scope || 'app',
      url: `assets/${folder}/${basename(outPath)}`,
      bytes,
      sourceBytes,
    });
    process.stdout.write(`  ${formatBytes(sourceBytes)} -> ${formatBytes(bytes)}\n`);
  }

  if (existsSync(TEMP_DIR)) rmSync(TEMP_DIR, { recursive: true, force: true });

  const critical = built.filter((a) => a.priority === 'critical' && a.scope !== 'dev');
  const criticalBytes = critical.reduce((sum, a) => sum + a.bytes, 0);
  const budget = source.budget.firstFrameBytes;

  // No timestamp: the manifest is versioned, and a build that changes nothing
  // must not show up as a change.
  const manifest = {
    budget: source.budget,
    criticalBytes,
    assets: built,
  };
  writeFileSync(OUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  mkdirSync(dirname(CACHE_FILE), { recursive: true });
  writeFileSync(CACHE_FILE, `${JSON.stringify(nextCache, null, 2)}\n`, 'utf8');

  process.stdout.write(`\nfirst frame: ${formatBytes(criticalBytes)} of ${formatBytes(budget)} budget\n`);
  if (criticalBytes > budget) {
    throw new Error('first frame budget exceeded: lighten assets or move them to "deferred"');
  }

  // AND THE SKY, WHATEVER ITS PRIORITY.
  //
  // The budget above only ever sees what the first frame waits for, and none of
  // the sky is critical: it streams in behind the walk. So a sky asset that
  // nothing draws costs a visitor its whole weight and no check in this chain
  // can tell. Measured on the delivery this line was written for: three
  // relighting textures and their table, 2 436 131 B, streamed by every visitor
  // of a manifest whose own `source` says the runtime draws the other field.
  // Those four have since been taken out of the delivery altogether, which is
  // the only thing that actually stops the bytes: "scope": "dev" keeps an entry
  // out of this count and out of the first frame, and does nothing whatever
  // about a file sitting in public/ that the build copies wholesale. Counting
  // on the shipped entries only is still right, and it is not a substitute for
  // deleting what nothing draws.
  const skyBudget = source.budget.skyBytes;
  if (skyBudget) {
    const sky = built.filter((a) => a.scope !== 'dev' && a.id.startsWith('cloud-'));
    const skyBytes = sky.reduce((sum, a) => sum + a.bytes, 0);
    process.stdout.write(`sky: ${formatBytes(skyBytes)} of ${formatBytes(skyBudget)} budget `
      + `(${sky.map((a) => a.id).join(', ')})\n`);
    if (skyBytes > skyBudget) {
      throw new Error('sky budget exceeded: lighten the atlas or take an asset '
        + 'nothing draws out of the shipped manifest');
    }
  }
  process.stdout.write(`manifest: ${OUT_MANIFEST}\n`);
}

main();
