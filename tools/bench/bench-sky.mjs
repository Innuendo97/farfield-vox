import { createRequire } from 'node:module';
import path from 'node:path';

// WHAT THE SKY COSTS, MEASURED RATHER THAN ARGUED.
//
//   node tools/bench/bench-sky.mjs [--port 4316] [--pairs 8] [--inject]
//
// The sky is allocated 1,2 ms of the frame. Before this existed that allocation
// was an opinion: the only tool in this tree that drives a browser measures
// COLOUR, and the one attempt to time the dome by hand came back with two
// readings a factor of sixteen apart, which is not a measurement.
//
// FOUR THINGS MAKE A SMALL DELTA READABLE, and each of them is here because
// leaving it out produced a number that could not be believed.
//
// 1. THE GPU'S OWN CLOCK. The wall clock times the queue, not the work. What is
//    read is EXT_disjoint_timer_query_webgl2 through the renderer's own timing
//    path, so this measures the same thing the frame gate is judged on.
//
// 2. MANY SHORT ALTERNATING ARMS, AND THE DIFFERENCE TAKEN INSIDE THE PAIR. A
//    machine warming, or another session's server waking, moves both arms of a
//    pair together and cancels. Only what the switch itself does survives.
//
// 3. THE ORDER FLIPPED EVERY PAIR. A monotone drift enters the differences with
//    alternating sign and cannot bias the median. Without this a drift of the
//    same size as the effect reads as the effect.
//
// 4. A NULL ARM — the same arm measured twice — PRINTED BESIDE THE REAL ONES. It
//    is the noise floor of the method on the day, and a result smaller than its
//    own null arm is not a result. It is also half of the validation: the null
//    must come back at nothing while the real arms come back at something.
//
// THE TRAP THIS TOOL WOULD OTHERWISE FALL INTO, AND IT COST A RUN TO FIND.
// post.js hands a timing reading out ONCE — read() returns the reading and
// clears the flag — and src/main.js already consumes it every frame. A second
// reader therefore gets null forever, and a bench that polls read() directly
// collects nothing and reports NaN. So the reading is taken THROUGH THE
// APPLICATION'S OWN CALL: renderer.timings is wrapped, the wrapper forwards to
// the original and keeps a copy on the way past. Nothing is consumed that the
// page was not already consuming.
//
// VALIDATED IN BOTH DIRECTIONS. --inject patches extra powers into the dome's
// fragment shader on the running page, so the same run can be asked to find a
// cost that is known to be there and known not to be. A metric that only ever
// reports small numbers has not been shown to be able to report a large one.

const require = createRequire('file:///C:/workspace-project/farfield-hub/package.json');
const { chromium } = require('playwright');

const REPO = 'C:/workspace-project/vox-v6';
const MODULES = 'C:/workspace-project/farfield-vox/node_modules';
const VITE = 'file:///C:/workspace-project/farfield-vox/node_modules/vite/dist/node/index.js';

const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const PORT = Number(flag('port', 4316));
const PAIRS = Number(flag('pairs', 10));
const SAMPLES = Number(flag('samples', 180));
const INJECT = process.argv.includes('--inject');
const POSES = flag('poses', 'vox-giorno,bordo-indietro').split(',');

// The campaign's allocation for this layer, from SESSIONI-VOX.md section 2.9. It
// is not a measurement and it is not this tool's to move: R4 says a layer over
// budget is declared, with the number and the pose, and the coordinator decides.
const ALLOCATION_MS = 1.2;

const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN;
};

async function main() {
  const { createServer } = await import(VITE);
  const server = await createServer({
    root: REPO,
    configFile: path.join(REPO, 'vite.config.js'),
    server: { port: PORT, strictPort: true, fs: { allow: [REPO, MODULES] } },
  });
  await server.listen();

  const browser = await chromium.launch({
    headless: false,
    // The real rasteriser through ANGLE, and the window on screen: a window
    // placed off screen is not composited, and what it reports is not the cost
    // of drawing anything.
    args: ['--use-angle=d3d11', '--use-gl=angle', '--enable-gpu',
      '--ignore-gpu-blocklist', '--window-position=0,0'],
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1672, height: 941 }, deviceScaleFactor: 1,
    });
    // THE CLOCK IS FROZEN, AND THAT IS WHAT MAKES THE NULL ARM SMALL ENOUGH TO
    // MEASURE AGAINST. With time running the weather drifts, the grass sways and
    // the arrival keeps changing what is on screen, so two arms of one pair are
    // not two measurements of one picture. The first run of this bench came back
    // with a noise floor of 0,83 ms at vox-giorno — most of the effect it was
    // trying to resolve — and freezing the world is what that bought back.
    await page.goto(`http://localhost:${PORT}/?dev&t0`, { waitUntil: 'load', timeout: 300000 });
    await page.waitForFunction(() => window.farfield?.hub && window.farfield?.renderer,
      null, { timeout: 300000 });
    await page.bringToFront();

    const renderer = await page.evaluate(() => {
      const gl = document.querySelector('canvas').getContext('webgl2');
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        name: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        clock: Boolean(gl.getExtension('EXT_disjoint_timer_query_webgl2')),
      };
    });
    process.stdout.write(`renderer   ${renderer.name}\n`);
    process.stdout.write(`gpu clock  ${renderer.clock ? 'EXT_disjoint_timer_query_webgl2' : 'ABSENT'}\n`);
    if (/swiftshader/i.test(renderer.name)) {
      process.stdout.write('  *** SwiftShader: not the rasteriser anything here may be judged on ***\n');
      process.exitCode = 1;
      return;
    }
    if (!renderer.clock) {
      process.stdout.write('  *** no GPU clock: the wall clock times the queue, not the work ***\n');
      process.exitCode = 1;
      return;
    }

    await page.evaluate(() => {
      const f = window.farfield;
      f.quality.setChoice('bassa');
      // The application's own benchmark loop moves the quality tier under the
      // measurement, which is a second hand on the thing being measured.
      if (f.bench && f.bench.stop) f.bench.stop();
      f.renderer.setTiming(true);
      for (const s of ['.dev-hud', '.dev-panel', '.overlay-start', '.reticle']) {
        document.querySelectorAll(s).forEach((n) => { n.style.display = 'none'; });
      }
      window.__bench = { samples: [], on: false };
      const original = f.renderer.timings.bind(f.renderer);
      f.renderer.timings = () => {
        const t = original();
        if (t && t.total > 0 && window.__bench.on) window.__bench.samples.push(t.total);
        return t;
      };
    });

    if (INJECT) {
      // THE INJECTED COST IS SWITCHED BY A UNIFORM, NOT BY A SECOND SHADER, and
      // both wrong ways round are worth recording because each produced a number
      // that looked like an answer.
      //
      // Comparing two RUNS — patched and clean — threw away the pairing the rest
      // of this file is built on: the two had different noise floors, the
      // injection did not show above either, and the weather arm, which cannot
      // move because the dome is up in both of ITS arms, moved further than the
      // injection did. Drift read as signal.
      //
      // Pairing two MATERIALS inside one run was worse: it reported the injected
      // dome as 0,74 ms FASTER than the clean one, which is not a thing 32 extra
      // powers can be. Swapping the material swaps the program, and what the
      // clock then measures is the pipeline change and the recompile as much as
      // the arithmetic.
      //
      // So the shader is compiled ONCE, with the extra work behind a uniform the
      // arms write. The branch is uniform across every fragment, so both arms are
      // coherent, and nothing but the arithmetic differs between them.
      const built = await page.evaluate(() => {
        const dome = window.farfield.scene.getObjectByName('sky');
        if (!dome) return false;
        const before = dome.material.fragmentShader;
        dome.material.uniforms.uInject = { value: 0 };
        dome.material.fragmentShader = before.replace(
          'precision highp float;',
          'precision highp float;\nuniform float uInject;',
        ).replace(
          'vec3 colour = skyDome(vDirection, 1.0);',
          `vec3 colour = skyDome(vDirection, 1.0);
           float injected = 0.0;
           for (int i = 0; i < 32; i++) {
             if (float(i) < uInject) {
               injected += pow(abs(vDirection.x) + float(i) * 0.01, 2.7);
             }
           }
           colour += vec3(injected * 1e-9);`,
        );
        dome.material.needsUpdate = true;
        window.__sky = { dome };
        return dome.material.fragmentShader !== before;
      });
      process.stdout.write(`injected   ${built ? '32 powers behind a uniform, one program' : 'FAILED'}
`);
      if (!built) { process.exitCode = 1; return; }
    }

    // The world arrives in pieces, and a layer measured against a world that is
    // still arriving is measured against a different screen every pair.
    let settled = null;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(1000);
      const now = await page.evaluate(() => window.farfield.renderer.stats());
      if (settled && now.triangles === settled.triangles
        && now.drawCalls === settled.drawCalls && now.triangles > 5000) break;
      settled = now;
    }
    process.stdout.write(`world      ${JSON.stringify(settled)}\n`);
    process.stdout.write(`method     ${PAIRS} pairs per contrast, order flipped every pair,\n`);
    process.stdout.write('           difference taken inside the pair, median of the differences\n\n');

    const arm = async (clouds, sky, dirty = false) => {
      await page.evaluate(({ c, s, d }) => {
        const f = window.farfield;
        if (f.hub.setCloudsVisible) f.hub.setCloudsVisible(c);
        const dome = f.scene.getObjectByName('sky');
        if (dome) dome.visible = s;
        if (window.__sky) window.__sky.dome.material.uniforms.uInject.value = d ? 32 : 0;
        window.__bench.samples.length = 0;
        window.__bench.on = false;
      }, { c: clouds, s: sky, d: dirty });
      // Frames thrown away after every switch: the first frames after a state
      // change carry the change itself — a shader bound, a buffer grown.
      await page.waitForTimeout(700);
      await page.evaluate(() => { window.__bench.samples.length = 0; window.__bench.on = true; });
      let got = [];
      for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(200);
        got = await page.evaluate(() => window.__bench.samples.slice());
        if (got.length >= SAMPLES) break;
      }
      await page.evaluate(() => { window.__bench.on = false; });
      return { ms: median(got), n: got.length };
    };

    const CONTRASTS = [
      ['sky', 'the sky      (dome on/off, weather off in both)', [false, true], [false, false]],
      ['weather', 'the weather  (weather on/off, dome up in both)', [true, true], [false, true]],
      ['null', 'NOTHING      (the same arm twice: the noise floor)', [true, true], [true, true]],
    ];
    if (INJECT) {
      CONTRASTS.unshift(['injected',
        'THE INJECTION (32 powers in the dome vs the dome as it ships)',
        [false, true, true], [false, true, false]]);
    }

    const results = {};
    for (const pose of POSES) {
      await page.evaluate((p) => window.setDevPose(p), pose);
      await page.waitForTimeout(1500);
      process.stdout.write(`POSE ${pose}\n`);
      results[pose] = {};
      for (const [id, what, aOn, bOn] of CONTRASTS) {
        const diffs = [];
        let frames = Infinity;
        for (let p = 0; p < PAIRS; p++) {
          const first = p % 2 === 0;
          const a = await arm(...(first ? aOn : bOn));
          const b = await arm(...(first ? bOn : aOn));
          frames = Math.min(frames, a.n, b.n);
          diffs.push(first ? a.ms - b.ms : b.ms - a.ms);
        }
        const sorted = [...diffs].sort((x, y) => x - y);
        const positive = diffs.filter((d) => d > 0).length;
        const mid = median(diffs);
        results[pose][id] = mid;
        process.stdout.write(`  ${what}\n`);
        process.stdout.write(`    median ${mid.toFixed(3)} ms   spread `
          + `${(sorted[sorted.length - 1] - sorted[0]).toFixed(3)}   `
          + `${positive} of ${PAIRS} readings positive\n`);
        process.stdout.write(`    ${diffs.map((d) => d.toFixed(3)).join(' ')}\n`);
      }

      const layer = results[pose].sky + results[pose].weather;
      const floor = Math.abs(results[pose].null);
      process.stdout.write(`  LAYER ${layer.toFixed(3)} ms against an allocation of `
        + `${ALLOCATION_MS} — ${layer <= ALLOCATION_MS ? 'INSIDE' : 'OVER'} by `
        + `${Math.abs(ALLOCATION_MS - layer).toFixed(3)} ms, `
        + `over a noise floor of ${floor.toFixed(3)} ms\n`);
      if (floor >= Math.abs(layer) / 2) {
        process.stdout.write('    THE FLOOR IS WITHIN A FACTOR OF TWO OF THE RESULT: this pose\n');
        process.stdout.write('    does not carry a verdict. Say so rather than reporting the median.\n');
      }
      process.stdout.write('\n');
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

await main();
