import { createHash } from 'node:crypto';
import { stoneTileData } from '../../src/world/voxel/pure.js';
import { read, reporter, selfTest, walk } from './lib.mjs';

// THE PADDING OF THE STONE TILES, AND WHY TODAY IT IS CORRECTLY NOUGHT.
//
// THE CONVENTION IS READ FROM THE MATERIAL, not restated here. src/world/voxel/
// masonry.js declares how the stone is sampled -- the wrap mode, the mip chain,
// the side of a tile -- and that declaration is what decides which padding is
// right. A guard carrying its own copy of the convention would go on passing a
// delivery that had stopped matching the material, which is the failure it
// exists to prevent.
//
// TODAY THE CONVENTION IS "WRAP, DO NOT PAD". There is one tile, generated
// rather than delivered, sampled with RepeatWrapping and a full mip chain. Under
// wrapping, padding is not merely unnecessary, it is WRONG: the texel past the
// last column IS the first column, so a gutter would be a seam. The right
// padding is nought -- and a nought has to be EARNED, so the leg that runs today
// is the one that earns it: the field must actually be periodic. If it were not,
// every wall in this world would carry a line down it once per tile, and nothing
// else in this repository would say so.
//
// AND IT ARMS ITSELF WHEN V2 DELIVERS. A sheet of many tiles is the other
// convention, and it inverts the answer: bilinear filtering reaches across a
// tile boundary and every mip level reaches twice as far, so a sheet needs a
// gutter and a clamp. If a sheet turns up while the material still says
// RepeatWrapping, the delivery and the material disagree, and the guard says so
// rather than measuring the wrong thing.
//
// IT IS ARMED NOW, AND WHAT ARRIVED IS NOT A SHEET -- so this file learned to
// ask WHICH CONVENTION A DELIVERY IS IN instead of assuming. That is the same
// rule one level up: the guard reads the convention out of the material and it
// now reads the delivery's out of the delivery, because "a file whose name
// matches /stone-tile/ is a sheet" was a restatement of a convention exactly
// like the one this file refuses to carry about the material. What V2 delivered
// is assets-src/stone-tiles/, a CONTRACT for V5 to consume read-only (E-V5b),
// declaring one wrapping tile that is generated rather than shipped.
//
// SO THERE ARE THREE LEGS AND THE STRICTEST ONE IS THE NEW ONE. Nothing
// delivered: earn the nought by periodicity. A wrapping-tile contract: earn the
// nought by periodicity AND check every line of the contract against the
// material and against the generator's actual bytes -- the side, the wrap, the
// mips, the gutter, the length, the sha256. A sheet: the material must have
// stopped wrapping first, and then the gutter has to survive the mip chain.
//
// A contract that agrees with a comment is worth nothing; one that agrees with
// the bytes a consumer will actually receive is the whole of what V5 is being
// asked to build on.

const MATERIAL = 'src/world/voxel/masonry.js';

// The seam may be no worse than an ordinary step between neighbours. Not "equal"
// -- the field is noise, and two columns differ by chance -- and not "under some
// number", because what a small number is depends on the noise. A ratio against
// the field's own interior stays true if the generator is ever retuned.
const SEAM_RATIO = 1.5;

/** The convention, as the material states it. */
export function convention(text) {
  return {
    wrapping: /wrapS = RepeatWrapping/.test(text) && /wrapT = RepeatWrapping/.test(text),
    mipmapped: /generateMipmaps = true/.test(text),
    side: Number((/stoneTile\(data, side = (\d+)\)/.exec(text) || [])[1]),
  };
}

/** How far a field jumps at its own seam, against how far it jumps inside. */
export function seams(data, side, channels = 2) {
  const at = (x, y) => data[(y * side + x) * channels];
  return ['columns', 'rows'].map((axis) => {
    let seamSum = 0;
    let seamMax = 0;
    let inSum = 0;
    let inMax = 0;
    let inCount = 0;
    for (let a = 0; a < side; a++) {
      const jump = axis === 'columns'
        ? Math.abs(at(0, a) - at(side - 1, a))
        : Math.abs(at(a, 0) - at(a, side - 1));
      seamSum += jump;
      if (jump > seamMax) seamMax = jump;
      for (let b = 1; b < side; b++) {
        const step = axis === 'columns'
          ? Math.abs(at(b, a) - at(b - 1, a))
          : Math.abs(at(a, b) - at(a, b - 1));
        inSum += step;
        if (step > inMax) inMax = step;
        inCount++;
      }
    }
    return {
      axis, seamMean: seamSum / side, seamMax, interiorMean: inSum / inCount, interiorMax: inMax,
    };
  });
}

/** Whether one axis is periodic to the precision the field's own noise allows. */
export const wraps = (seam) => seam.seamMean <= SEAM_RATIO * seam.interiorMean
  && seam.seamMax <= seam.interiorMax;

/**
 * Whether a sheet of tiles may be sampled by the convention the material states.
 *
 * A sheet under a wrapping sampler has no valid gutter at all: the sampler does
 * not know where a tile ends, so every boundary bleeds and no padding can stop
 * it. This is the one question that has to be asked before any gutter is
 * measured, because a measured gutter on a wrapping sheet would be a green tick
 * on a wall full of seams.
 */
export const sheetMayBeSampled = (stated) => !stated.wrapping;

/** The gutter a sheet needs to survive the mip chain the material asks for. */
export const safeGutter = (stated) => (stated.mipmapped ? stated.side / 2 : 1);

/** Whatever V2 has delivered under a stone-tile name, or null while nothing has. */
export function findSheet() {
  const found = walk('assets-src', (path) => /stone-tile/i.test(path));
  return found.length ? found : null;
}

/**
 * Which convention a delivery is in, as the DELIVERY states it.
 *
 * A declaration and not a guess. `tiles: 1` with `wrap: "repeat"` is the
 * contract V2 publishes for V5 -- one tile that wraps, generated rather than
 * shipped; anything else is a sheet and is measured as one. A delivery that
 * declares neither is a sheet by default, which is the safe way round: the
 * sheet leg is the one that refuses a wrapping sampler outright.
 */
export function deliveredKind(declared) {
  return declared && declared.tiles === 1 && declared.wrap === 'repeat'
    ? 'wrapping-tile' : 'sheet';
}

if (process.argv.includes('--self')) {
  const side = 64;
  const good = stoneTileData(side);
  // A ramp along x breaks the wrap and only the wrap: every interior step grows
  // by one, the seam by the whole width.
  const broken = Uint8Array.from(good);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const o = (y * side + x) * 2;
      broken[o] = Math.min(255, broken[o] + x);
      broken[o + 1] = broken[o];
    }
  }
  const stated = convention(read(MATERIAL));
  const clamped = { ...stated, wrapping: false };
  selfTest('guard-padding', [
    {
      what: 'the convention comes out of the material and not out of this file',
      caught: stated.side === 512 && stated.wrapping && stated.mipmapped,
    },
    { what: 'the tile as generated wraps on both axes', caught: seams(good, side).every(wraps) },
    { what: 'a tile that has stopped wrapping is caught', caught: !seams(broken, side).every(wraps) },
    {
      what: 'a sheet arriving while the material still wraps is refused',
      caught: !sheetMayBeSampled(stated),
    },
    { what: 'a sheet under a clamped sampler is allowed to be measured', caught: sheetMayBeSampled(clamped) },
    { what: 'a gutter of nought on a mipmapped sheet is under the safe one', caught: 0 < safeGutter(clamped) },
    { what: 'a gutter of half a tile is not', caught: 256 >= safeGutter(clamped) },
    // AND THE TWO CONVENTIONS ARE TOLD APART BY WHAT THE DELIVERY SAYS, in both
    // directions: a contract that forgot to declare itself has to fall to the
    // strict leg, not to the lenient one.
    {
      what: 'a delivery declaring one wrapping tile is read as the contract',
      caught: deliveredKind({ tiles: 1, wrap: 'repeat' }) === 'wrapping-tile',
    },
    {
      what: 'a delivery of many tiles is read as a sheet',
      caught: deliveredKind({ tiles: 16, wrap: 'clamp' }) === 'sheet',
    },
    {
      what: 'a delivery that declares neither falls to the sheet leg, which is the strict one',
      caught: deliveredKind({}) === 'sheet' && deliveredKind(null) === 'sheet',
    },
    {
      what: 'one wrapping tile declared under a clamped sampler is not the contract',
      caught: deliveredKind({ tiles: 1, wrap: 'clamp' }) === 'sheet',
    },
  ]);
}

const report = reporter('guard-padding -- the stone tiles, against the convention the material states');

const stated = convention(read(MATERIAL));
report.line(`  ${MATERIAL} samples the stone: ${stated.wrapping ? 'RepeatWrapping' : 'clamped'}`
  + `, ${stated.mipmapped ? 'full mip chain' : 'no mipmaps'}, ${stated.side} square`);
report.check(Number.isInteger(stated.side) && stated.side > 0,
  'the material states the side of a tile', `${stated.side}`);

const sheet = findSheet();

if (!sheet) {
  report.check(stated.wrapping, 'one wrapping tile, so the right gutter is nought');
  for (const seam of seams(stoneTileData(stated.side), stated.side)) {
    report.check(wraps(seam), `the tile is periodic across its ${seam.axis}`,
      `seam ${seam.seamMean.toFixed(3)} mean / ${seam.seamMax} worst, `
      + `against ${seam.interiorMean.toFixed(3)} / ${seam.interiorMax} inside`);
  }
  report.note('no atlas yet: the stone is one generated wrapping tile and its nought gutter is '
    + 'earned, not assumed. The sheet leg arms the day V2 delivers assets-src/stone-tiles/');
  report.end();
}

report.line(`  a stone delivery is on disk: ${sheet.join(', ')}`);

const manifests = sheet.filter((p) => p.endsWith('.json'));
report.check(manifests.length > 0, 'the delivery declares itself',
  manifests.length ? manifests.join(', ') : 'files with no manifest beside them cannot be checked');

for (const path of manifests) {
  const declared = JSON.parse(read(path));
  const kind = deliveredKind(declared);
  report.line(`\n  ${path} declares itself a ${kind}`);

  if (kind === 'sheet') {
    report.check(sheetMayBeSampled(stated),
      'the material has stopped sampling the stone as one wrapping tile',
      stated.wrapping
        ? 'a sheet under RepeatWrapping bleeds at every tile boundary and every mip level' : '');
    const gutter = declared.padding ?? declared.gutter;
    if (!report.check(typeof gutter === 'number', `${path} declares its gutter`,
      typeof gutter === 'number' ? `${gutter} texels` : 'a sheet with no declared gutter cannot be checked')) {
      continue;
    }
    report.check(gutter >= safeGutter(stated),
      `${path} gutter survives the mip chain the material asks for`,
      `${gutter} against ${safeGutter(stated)}`);
    continue;
  }

  // THE CONTRACT, AGAINST THE MATERIAL AND AGAINST THE BYTES.
  //
  // Every line of it is something a consumer in another session will build on
  // without being able to see this material, so every line of it is checked
  // against what a consumer would actually receive rather than against what
  // this file believes.
  report.check(declared.side === stated.side, `${path} states the side the material samples`,
    `${declared.side} against ${stated.side}`);
  report.check(stated.wrapping, 'the material still samples the stone as one wrapping tile',
    'the contract promises RepeatWrapping to whoever consumes it');
  report.check(declared.mipmaps === stated.mipmapped, `${path} states the mip chain the material asks for`,
    `${declared.mipmaps} against ${stated.mipmapped}`);
  report.check((declared.padding ?? declared.gutter) === 0, `${path} declares a gutter of nought`,
    'under wrapping a gutter would BE the seam it is meant to prevent');

  const data = stoneTileData(declared.side);
  report.check(data.length === declared.bytes, `${path} states what the generator actually produces`,
    `${data.length} against ${declared.bytes}`);
  const sum = createHash('sha256')
    .update(Buffer.from(data.buffer, data.byteOffset, data.length)).digest('hex');
  report.check(sum === declared.sha256, `${path} fingerprints the bytes a consumer will get`,
    sum === declared.sha256 ? sum.slice(0, 16) : `${sum.slice(0, 16)} against ${String(declared.sha256).slice(0, 16)}`);

  for (const seam of seams(data, declared.side)) {
    report.check(wraps(seam), `the delivered tile is periodic across its ${seam.axis}`,
      `seam ${seam.seamMean.toFixed(3)} mean / ${seam.seamMax} worst, `
      + `against ${seam.interiorMean.toFixed(3)} / ${seam.interiorMax} inside`);
  }
  report.note(`${path} is a contract for another session to read: any change to the side, the `
    + 'format, the wrap or this path is a notification to the coordinator, never a silent edit');
}

report.end();
