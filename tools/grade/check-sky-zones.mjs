// Has the sky moved? Seven boxes, one pose, and a file that remembers.
//
//   node tools/grade/check-sky-zones.mjs            (npm run sky:zones)
//   node tools/grade/check-sky-zones.mjs --root=../wt --port=5311
//   node tools/grade/check-sky-zones.mjs --pretend-shift=3   (prove it can fail)
//   node tools/grade/check-sky-zones.mjs --bare              (prove it can fail)
//
// Exit 0 if all seven zones sit inside the tolerance in tools/grade/sky-zones.json,
// exit 1 with a per-zone table if any of them does not.
//
// WHY THIS EXISTS. The sky was sealed by its own session and every session after
// it carries a written net — «cielo entro 2 livelli» — against moving it by
// accident. The seven numbers that net is tied to were measured once, by a gate,
// and lived only in that gate's working notes, which the repository throws away.
// A net with nothing to tie to is not a net. So the numbers moved into a tracked
// file and this is the hand that pulls on it.
//
// WHY IT DRIVES A BROWSER RATHER THAN READING A BAKED IMAGE. What the tolerance
// is about is the frame a visitor arrives on, and that frame is assembled by the
// renderer and then covered by a DOM overlay that no offline pipeline sees. The
// only place the two exist together is a page.
//
// WHY A DEV SERVER AND NOT THE SHIPPED BUILD. The build is not instrumentable:
// `window.farfield` is published behind `import.meta.env.DEV`, so in a production
// bundle there is no handle to set a pose with. The tree is served with Vite's own
// dev server instead, and `--root` points that server at a clean worktree when the
// tree in front of you is not the one you mean to measure.
//
// WHY THE PAGE IS PHOTOGRAPHED AND NOT THE CANVAS. The arrival veil is an overlay
// in the DOM. A canvas read back through toDataURL is the same frame with the veil
// missing, which is a different picture by design — and `--bare` takes exactly that
// picture, on purpose, as the defect this tool has to be able to find.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { readDressedFrame, waitForDressedFrame } from './lib/dressed-frame.mjs';
import { REFERENCE_POSE, surveyPose } from './lib/survey-poses.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SPEC = JSON.parse(readFileSync(path.join(HERE, 'sky-zones.json'), 'utf8'));

/** Rec.709 on the coded values, of the box's mean colour — the file says so too. */
function zoneLuminance(pixels, frame, box) {
  if (box.x < 0 || box.y < 0 || box.x + box.w > frame.width || box.y + box.h > frame.height) {
    throw new Error(`zone box ${JSON.stringify(box)} falls outside a ${frame.width}x${frame.height} frame`);
  }
  let r = 0; let g = 0; let b = 0; let n = 0;
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const p = (y * frame.width + x) * frame.channels;
      r += pixels[p]; g += pixels[p + 1]; b += pixels[p + 2]; n++;
    }
  }
  return 0.2126 * (r / n) + 0.7152 * (g / n) + 0.0722 * (b / n);
}

/**
 * The browser driver, asked for by name rather than declared as a dependency.
 *
 * Every capture in this project's history has driven the page through Playwright
 * out of an unsaved install, and the shipped product needs none of it: putting it
 * in package.json would hand every install of the site a browser download for the
 * sake of one measuring tool. So it is asked for at the moment it is needed, and a
 * machine that has not got it is told what to type instead of being handed a stack.
 */
async function browserDriver() {
  try {
    return (await import('playwright')).chromium;
  } catch (cause) {
    throw new Error('this tool drives a browser and Playwright is not installed here.'
      + ' Install it without touching package.json:'
      + '\n    npm i --no-save playwright && npx playwright install chromium', { cause });
  }
}

/** Vite over a tree, with the one allowance a worktree's junctioned modules need. */
async function serveTree(root, port) {
  const { createServer } = await import('vite');
  const server = await createServer({
    root,
    configFile: path.join(root, 'vite.config.js'),
    // A worktree gets its node_modules as a junction to the one real copy, and
    // Vite resolves that junction back to a path outside the root and then
    // refuses to serve from it. The allowance belongs here and not in
    // vite.config.js: a worktree has to stay byte for byte the commit it was
    // made from, or what is measured in it is something else.
    server: { port, strictPort: true, fs: { allow: [root, path.join(REPO, 'node_modules')] } },
  });
  await server.listen();
  return server;
}

/**
 * One frame of the arrival composition, at the reference pose.
 *
 * @param {object} options
 * @param {number} options.port  where the tree is being served
 * @param {boolean} options.bare read the drawing buffer instead of the page — the
 *        injected defect, not a mode anyone should measure with
 * @returns {Promise<{png: Buffer, renderer: string, errors: string[], guard: object}>}
 */
async function shootArrival({ port, bare }) {
  const { width, height } = SPEC.conditions.viewport;
  const chromium = await browserDriver();
  const browser = await chromium.launch({
    headless: false,
    args: ['--use-angle=d3d11', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist',
      '--window-position=0,0'],
  });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    // Hot reload is stubbed out rather than tolerated: a module swap in the middle
    // of a measurement is a measurement of two different trees.
    await page.route('**/@vite/client', (route) => route.fulfill({
      contentType: 'text/javascript',
      body: `const noop = () => {};
        export const createHotContext = () => ({ on: noop, off: noop, send: noop, accept: noop,
          acceptExports: noop, dispose: noop, prune: noop, invalidate: noop, data: {} });
        export const injectQuery = (url) => url;
        export const removeStyle = noop; export const updateStyle = noop;
        export const ErrorOverlay = class {}; export { noop as default };`,
    }));
    await page.goto(`http://localhost:${port}/${SPEC.conditions.url}`, { waitUntil: 'load', timeout: 300000 });
    await page.waitForFunction(() => window.farfield?.hub && window.farfield?.renderer,
      null, { timeout: 300000 });
    await page.bringToFront();

    const renderer = await page.evaluate(() => {
      const gl = document.querySelector('canvas').getContext('webgl2');
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });

    await page.evaluate(({ w, h, quality, hidden }) => {
      const f = window.farfield;
      window.__skyZones = {
        draw(pose) {
          f.quality.setChoice(quality);
          if (f.bench && f.bench.stop) f.bench.stop();
          for (const selector of hidden) {
            document.querySelectorAll(selector).forEach((n) => { n.style.display = 'none'; });
          }
          f.renderer.resize(w, h);
          f.player.setPose({
            position: { x: pose.x, y: pose.y ?? 1.70, z: pose.z }, yaw: pose.yaw, pitch: pose.pitch,
          });
          f.player.applyTo(f.camera);
          f.camera.fov = pose.fov;
          f.camera.aspect = w / h;
          f.camera.updateProjectionMatrix();
          f.hub.update(100, f.camera.position, 1 / 60, pose.pitch);
          f.renderer.render(f.scene, f.camera);
        },
        // Drawn and read back inside one task on purpose: the context is not
        // asked to preserve its drawing buffer, so by the next turn of the event
        // loop the buffer has been composited away and toDataURL answers black.
        // Read in two steps this returns a black frame, which fails the check for
        // a reason that has nothing to do with the sky.
        bare(pose) { this.draw(pose); return document.querySelector('canvas').toDataURL('image/png'); },
      };
    }, {
      w: width, h: height, quality: SPEC.conditions.quality, hidden: SPEC.conditions.hidden,
    });

    const pose = surveyPose(REFERENCE_POSE);
    const render = () => page.evaluate((p) => window.__skyZones.draw(p), pose);
    for (let i = 0; i < 5; i++) await render();
    await waitForDressedFrame({
      measure: async () => { await render(); return page.evaluate(readDressedFrame); },
      wait: (ms) => page.waitForTimeout(ms),
      report: (m) => console.log(m),
    });

    // The condition this file is named after, asked of the page rather than assumed.
    // A veil that has let go — an unfrozen clock, a walker who took a step — leaves a
    // frame that is legitimately brighter, and reporting that as a drifted sky would
    // send the next session hunting a defect that is not there.
    const veil = await page.evaluate(() => {
      const el = document.querySelector('.sky-veil');
      if (!el) return null;
      const style = getComputedStyle(el);
      return { opacity: Number(style.opacity), display: style.display, visibility: style.visibility };
    });
    if (!veil) throw new Error('ARRIVAL IS OVER: no .sky-veil on the page — the frame is not the composition this file measures');
    if (veil.display === 'none' || veil.visibility === 'hidden' || !(veil.opacity > 0.99)) {
      throw new Error(`ARRIVAL IS FADING: .sky-veil at opacity ${veil.opacity}, display ${veil.display}`);
    }

    // The world's loop is stopped so the frame read is the frame drawn.
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
    await page.waitForTimeout(200);
    await render();

    const png = bare
      ? Buffer.from((await page.evaluate((p) => window.__skyZones.bare(p), pose)).split(',')[1], 'base64')
      : await page.screenshot({ clip: { x: 0, y: 0, width, height } });

    return { png, renderer, errors, veil };
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit === undefined ? fallback : hit.slice(name.length + 3);
  };
  const root = path.resolve(REPO, flag('root', REPO));
  const port = Number(flag('port', 5310));
  const shift = Number(flag('pretend-shift', 0));
  const keep = flag('keep', null);
  const bare = args.includes('--bare');

  console.log(`tree      ${root}`);
  console.log(`reference ${path.relative(REPO, path.join(HERE, 'sky-zones.json')).replace(/\\/g, '/')}`
    + ` — sealed ${SPEC.sealedOn}, tolerance ${SPEC.tolerance}`);
  console.log(`pose      ${REFERENCE_POSE} at ${SPEC.conditions.viewport.width}x${SPEC.conditions.viewport.height}, ${SPEC.conditions.url}`);
  if (shift) console.log(`  *** --pretend-shift=${shift}: every reading is moved by ${shift} levels ***`);
  if (bare) console.log('  *** --bare: reading the drawing buffer, which has no veil on it ***');

  const server = await serveTree(root, port);
  let shot;
  try {
    shot = await shootArrival({ port, bare });
  } finally {
    await server.close();
  }

  console.log(`renderer  ${shot.renderer}`);
  if (/swiftshader/i.test(shot.renderer)) {
    console.log('  *** SwiftShader: this is not the rasteriser the reference was measured on ***');
  }
  console.log(`veil      .sky-veil up at opacity ${shot.veil.opacity}`);
  console.log(`console errors: ${shot.errors.length}`);
  if (keep) { writeFileSync(path.resolve(REPO, keep), shot.png); console.log(`frame kept in ${keep}`); }

  const { data, info } = await sharp(shot.png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== SPEC.conditions.viewport.width || info.height !== SPEC.conditions.viewport.height) {
    throw new Error(`frame is ${info.width}x${info.height}, the reference was measured at `
      + `${SPEC.conditions.viewport.width}x${SPEC.conditions.viewport.height}`);
  }

  const rows = SPEC.zones.map((zone) => {
    const read = zoneLuminance(data, info, zone.box) + shift;
    return { zone, read, drift: read - zone.luminance };
  });
  const failed = rows.filter((r) => Math.abs(r.drift) > SPEC.tolerance);

  console.log('');
  console.log('zone                 sealed     read    drift');
  for (const { zone, read, drift } of rows) {
    console.log(`${zone.name.padEnd(20)}${zone.luminance.toFixed(1).padStart(7)}`
      + `${read.toFixed(2).padStart(9)}${drift.toFixed(2).padStart(9)}`
      + `  ${Math.abs(drift) > SPEC.tolerance ? 'OUT' : 'ok'}`);
  }
  const worst = rows.reduce((a, b) => (Math.abs(b.drift) > Math.abs(a.drift) ? b : a));
  console.log(`worst ${worst.zone.name} at ${worst.drift.toFixed(2)} of ${SPEC.tolerance} allowed`);

  if (failed.length) {
    console.log(`\nSKY MOVED: ${failed.length} of ${rows.length} zones outside +/-${SPEC.tolerance}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nSKY HELD: all ${rows.length} zones inside +/-${SPEC.tolerance}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
