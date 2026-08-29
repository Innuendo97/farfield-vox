import { createRequire } from 'node:module';
import path from 'node:path';

// WHAT THE SKY COSTS, MEASURED RATHER THAN ARGUED.
//
//   node tools/bench/bench-sky.mjs [--port 4316] [--pairs 8] [--inject] [--side]
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
// --side puts the ONE flag on trial: src/world/clouds.js turned the weather's
// cull off and argued that it costs nothing because the quads all face the eye.
// That argument was never measured, and the run that first noticed reported a
// weather arm several tenths of a millisecond over what the same arm had read
// before the flag existed. This contrast is the reading that settles it.
const SIDE = process.argv.includes('--side');
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
    //
    // TWO SAMPLES THE SAME IS NOT SETTLED, AND THIS COST A WHOLE ROUND OF R4 TO
    // SEE. The pieces do not arrive on a schedule: the rocks land, the counts
    // hold still for a second or two while the atlas is still being fetched, and
    // the old test declared the world finished at 28 draws and 81.226 triangles
    // — WITH THE WEATHER NOT YET IN THE SCENE AT ALL. Every reading the previous
    // unit took at that pose was taken against that screen, where the dome sees
    // far more uncovered sky than it sees in the delivered frame, which inflates
    // the one arm and makes the other arm a measurement of nothing.
    //
    // So the test is now what it should always have been: the thing being
    // measured has to BE THERE, and the counts have to hold still for FIVE
    // samples running rather than two. Five is not a taste — the run that found
    // this watched the counts sit at 28/81.226 for three seconds and then take
    // two more steps, so a plateau of two proves nothing and a plateau of three
    // was still short. The whole arrival is printed rather than summarised, so
    // that a reading taken against a half-built world can be seen to be one
    // instead of having to be remembered.
    let settled = null;
    let still = 0;
    const arrival = [];
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(1000);
      const now = await page.evaluate(() => {
        const s = window.farfield.renderer.stats();
        s.weather = Boolean(window.farfield.scene.getObjectByName('clouds'));
        return s;
      });
      const same = settled && now.triangles === settled.triangles
        && now.drawCalls === settled.drawCalls;
      still = same ? still + 1 : 0;
      if (!same) arrival.push(`${i}s ${now.drawCalls}/${now.triangles}${now.weather ? '+w' : ''}`);
      settled = now;
      if (still >= 4 && now.triangles > 5000 && now.weather) break;
    }
    process.stdout.write(`arrival    ${arrival.join('  ')}\n`);
    process.stdout.write(`world      ${JSON.stringify(settled)}\n`);
    if (!settled?.weather) {
      process.stdout.write('  *** the weather never arrived: there is nothing here to A/B ***\n');
      process.exitCode = 1;
      return;
    }

    if (SIDE) {
      // THE FLAG HAS TO BE SHOWN TO DO SOMETHING BEFORE IT IS WORTH TIMING.
      //
      // The claim under test (src/world/clouds.js) is that DoubleSide costs
      // nothing, because every quad faces the walker and the cull therefore
      // rejects no fragment either way. An A/B that came back at nothing would
      // be consistent with that claim AND with a flag that never reached the
      // rasteriser at all, and those two have to be told apart before the
      // milliseconds mean anything.
      //
      // So the flag is validated in both directions on the picture, not on the
      // clock: the corner order of every quad is REVERSED on the page — which is
      // exactly the silent failure the DoubleSide line was written to make
      // impossible — and the drawn weather is counted at each side. Two-sided
      // the reversed geometry must still draw; front-side-only it must vanish.
      // If it does not vanish, the cull is not reaching this material and the
      // whole contrast below is measuring a no-op.
      const proof = await page.evaluate(async () => {
        const mesh = window.farfield.scene.getObjectByName('clouds');
        if (!mesh) return { ok: false, why: 'no clouds mesh' };
        // three.js: FrontSide 0, BackSide 1, DoubleSide 2 — asserted against
        // what the material actually ships with rather than assumed.
        window.__weather = { material: mesh.material, FRONT: 0, DOUBLE: 2 };
        const shipped = mesh.material.side;
        const pos = mesh.geometry.getAttribute('position');
        const idx = mesh.geometry.getIndex();
        const before = idx ? Array.from(idx.array) : null;
        const count = () => {
          const c = document.querySelector('canvas');
          const g = document.createElement('canvas');
          g.width = c.width; g.height = c.height;
          g.getContext('2d').drawImage(c, 0, 0);
          return { w: c.width, h: c.height, ctx: g.getContext('2d') };
        };
        // The weather is counted as the pixels that CHANGE when it is hidden, so
        // nothing has to be assumed about what a cloud looks like.
        const shot = async () => {
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const { w, h, ctx } = count();
          return ctx.getImageData(0, 0, w, h).data;
        };
        const differing = (a, b) => {
          let n = 0;
          for (let i = 0; i < a.length; i += 4) {
            if (Math.abs(a[i] - b[i]) > 2 || Math.abs(a[i + 1] - b[i + 1]) > 2
              || Math.abs(a[i + 2] - b[i + 2]) > 2) n += 1;
          }
          return n;
        };
        const hub = window.farfield.hub;
        // THE PICTURE HAS A FLOOR OF ITS OWN, AND IT HAS TO BE MEASURED BEFORE
        // ANY OF THESE COUNTS MEAN ANYTHING. Two shots of the SAME state do not
        // come back identical — the frame carries a dither, and the arrival is
        // still settling underneath — so "vanished" cannot be read as "zero". It
        // is read as "at the floor", and the floor is taken here, twice, with
        // nothing whatever changed between the shots.
        hub.setCloudsVisible(false);
        const bare = await shot();
        const floorHidden = differing(bare, await shot());
        hub.setCloudsVisible(true);
        const shownOnce = await shot();
        const floorShown = differing(shownOnce, await shot());
        const drawnAsShipped = differing(bare, shownOnce);
        // Reverse every triangle's winding, in place. This is the silent failure
        // the DoubleSide line exists to make impossible, staged on purpose.
        if (idx) {
          for (let i = 0; i + 2 < idx.array.length; i += 3) {
            const t = idx.array[i]; idx.array[i] = idx.array[i + 2]; idx.array[i + 2] = t;
          }
          idx.needsUpdate = true;
        }
        mesh.material.side = 2;
        const reversedTwoSided = differing(bare, await shot());
        mesh.material.side = 0;
        const reversedFrontOnly = differing(bare, await shot());
        // Put the geometry and the flag back exactly as they were.
        if (idx && before) { idx.array.set(before); idx.needsUpdate = true; }
        mesh.material.side = shipped;
        const restored = differing(bare, await shot());
        return {
          ok: true,
          shipped,
          indexed: Boolean(idx),
          vertices: pos.count,
          floor: Math.max(floorHidden, floorShown),
          floorHidden,
          floorShown,
          drawnAsShipped,
          reversedTwoSided,
          reversedFrontOnly,
          restored,
        };
      });
      if (!proof.ok || proof.shipped !== 2) {
        process.stdout.write(`side proof FAILED: ${proof.why || `material ships side ${proof.shipped}, not DoubleSide`}\n`);
        process.exitCode = 1; return;
      }
      if (!proof.indexed) {
        process.stdout.write('side proof FAILED: the weather geometry is not indexed, so the winding cannot be reversed here\n');
        process.exitCode = 1; return;
      }
      // Judged as a SHARE OF THE WEATHER, which is the quantity the claim is
      // about, with the picture's own floor printed beside it for scale. The
      // culled arm has to lose essentially all of the weather — a fiftieth left
      // is the bar, and what it actually leaves is a few hundred pixels of edge
      // against a quarter of a million — and the two-sided arm has to keep most
      // of it. Zero is not the bar, because the frame has a floor and a bar of
      // zero would be a bar no true result could clear.
      const vanished = proof.reversedFrontOnly <= proof.drawnAsShipped * 0.02;
      const stillDrawn = proof.reversedTwoSided >= proof.drawnAsShipped * 0.5;
      const bites = vanished && stillDrawn;
      process.stdout.write('side proof  the flag, validated on the picture before it is timed\n');
      process.stdout.write(`            the picture's own floor            ${proof.floor}   (same state twice: ${proof.floorHidden} hidden, ${proof.floorShown} shown)\n`);
      process.stdout.write(`            weather pixels as shipped          ${proof.drawnAsShipped}\n`);
      process.stdout.write(`            winding reversed, DoubleSide       ${proof.reversedTwoSided}  ${stillDrawn ? 'still drawn' : '*** GONE ***'}\n`);
      process.stdout.write(`            winding reversed, FrontSide        ${proof.reversedFrontOnly}  ${vanished ? 'vanished, at the floor' : '*** STILL DRAWN ***'}\n`);
      process.stdout.write(`            geometry and flag restored         ${proof.restored}\n`);
      process.stdout.write(`            ${bites ? 'THE CULL BITES: the flag reaches the rasteriser, so the contrast below is a real one' : '*** THE CULL DOES NOT BITE — the contrast below would be a no-op ***'}\n\n`);
      if (!bites) { process.exitCode = 1; return; }
    }

    process.stdout.write(`method     ${PAIRS} pairs per contrast, order flipped every pair,\n`);
    process.stdout.write('           difference taken inside the pair, median of the differences\n\n');

    const arm = async (clouds, sky, dirty = false, twoSided = true) => {
      await page.evaluate(({
        c, s, d, two,
      }) => {
        const f = window.farfield;
        if (f.hub.setCloudsVisible) f.hub.setCloudsVisible(c);
        const dome = f.scene.getObjectByName('sky');
        if (dome) dome.visible = s;
        if (window.__sky) window.__sky.dome.material.uniforms.uInject.value = d ? 32 : 0;
        // THE FLAG, AND ONLY THE FLAG. `side` is read live out of the material
        // by the renderer's own state block on every draw and is not part of
        // what makes a program, so writing it does not recompile and does not
        // rebind: what differs between these two arms is one GL cull-face
        // enable. `material.version` is deliberately NOT bumped — bumping it
        // would put a program refresh inside the contrast and the clock would
        // time that instead.
        const w = window.__weather;
        if (w) w.material.side = two ? w.DOUBLE : w.FRONT;
        window.__bench.samples.length = 0;
        window.__bench.on = false;
      }, {
        c: clouds, s: sky, d: dirty, two: twoSided,
      });
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
    if (SIDE) {
      // THE FLAG ALONE. Everything else is held: the weather is up in both arms,
      // the dome is up in both, nothing is injected, and the same program draws
      // the same quads over the same pixels. The one difference is whether the
      // back faces are culled — and since every quad already faces the walker,
      // the cull rejects nothing in either arm, which is precisely the claim
      // being put on trial.
      CONTRASTS.unshift(['side',
        'THE FLAG      (weather DoubleSide vs FrontSide, all else held)',
        [true, true, false, true], [true, true, false, false]]);
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
