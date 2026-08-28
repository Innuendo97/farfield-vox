import { join } from 'node:path';
import sharp from 'sharp';
import { FRAME, REPO_ROOT } from '../grade/lib/framing.mjs';

// One rectangle of the frame, enlarged, with the same rectangle of the
// reference under it. The regular crop set is fixed; this is for looking hard
// at one thing, which during a correction round is most of the looking there is.
//
//   node tools/terrain/zoom.mjs <render.png> <name> <x0> <y0> <x1> <y1> [scale]

const [render, name, x0, y0, x1, y1, scale = 3] = process.argv.slice(2);
const box = {
  left: Number(x0), top: Number(y0), width: Number(x1) - Number(x0), height: Number(y1) - Number(y0),
};
const zoom = (buffer) => sharp(buffer).extract(box)
  .resize(box.width * Number(scale), box.height * Number(scale), { kernel: 'nearest' })
  .png().toBuffer();

const flat = await sharp(render).removeAlpha()
  .resize(FRAME.width, FRAME.height, { fit: 'fill' }).png().toBuffer();
const a = await zoom(flat);
const b = await zoom(join(REPO_ROOT, 'target.png'));
const width = box.width * Number(scale);
const height = box.height * Number(scale);
const out = join(REPO_ROOT, 'shots', `compare-${name}.png`);
await sharp({
  create: { width, height: height * 2 + 8, channels: 3, background: { r: 20, g: 24, b: 28 } },
})
  .composite([{ input: a, top: 0, left: 0 }, { input: b, top: height + 8, left: 0 }])
  .png().toFile(out);
process.stdout.write(`${out}\n`);
