import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// THE ONE MACHINE IN THIS REPOSITORY THAT ACTUALLY DRAWS A FRAME FOR A GUARD.
//
// WHY IT EXISTS. Forty one guards stood on this tip and every one of them read
// SOURCE. That is the right instrument for almost everything -- a contract, a
// count, a winding, a constant -- and it is the wrong one for exactly one
// question: does the GLSL this repository writes still COMPILE, and does what
// it compiles into still put pixels on the screen. E-LUCE5 is the whole
// argument: the merge of cornice-1 onto U-LUCE-4's line left two declarations
// of uAirBeta and uAirPale in one program, GLSL calls that a redefinition, the
// hills and the lake stopped linking, NOTHING of the distant frame was drawn --
// and thirty seven guards out of thirty seven were green, because a guard that
// reads source does not run a compiler.
//
// So this is the mechanics of a frame and nothing else: a server, a browser, a
// recorder wired into the GL context BEFORE the renderer exists, and a way to
// read pixels back. Every judgement -- which programs are expected, what a band
// of the picture has to contain, what counts as a floor -- is the GUARD's, in
// guard-programmi.mjs, because a judgement written down here would be a second
// opinion about the same world in a file nobody reads.
//
// WHAT IT DELIBERATELY DOES NOT DO. It never touches a material, a layer or the
// post: it hides whole children of the scene for the length of one plate and
// puts them back. A guard that had to edit the thing it measures would be
// measuring the edit.

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const require = createRequire(join(REPO_ROOT, 'package.json'));

/**
 * What is on this machine, and what is missing.
 *
 * A guard that needs a browser and has none must SKIP rather than fail: the
 * protocol in lib.mjs says so, and a red guard on a machine that simply never
 * installed a browser teaches everyone to ignore the colour.
 */
export function toolsPresent() {
  const missing = [];
  let chromium = null;
  let sharp = null;
  try { ({ chromium } = require('playwright')); } catch { missing.push('playwright'); }
  try { sharp = require('sharp'); } catch { missing.push('sharp'); }
  return { chromium, sharp, missing };
}

/** A port nothing is listening on, asked of the operating system. */
function freePort() {
  return new Promise((settle, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => settle(port));
    });
  });
}

async function answers(port, ms = 1500) {
  try {
    const reply = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(ms) });
    return reply.ok;
  } catch {
    return false;
  }
}

// ---------------------------------- THE DEPENDENCY CACHE, AND WHOSE IT IS NOT
//
// A DEFECT THIS FILE SHIPPED, FOUND BY MEASUREMENT AND CLOSED HERE.
//
// node_modules is ONE DIRECTORY for the whole campaign: every worktree reaches
// C:\workspace-project\farfield-vox\node_modules through a link, which is
// E-OPS2 for the build cache and is the same fact one floor down. Vite puts its
// pre-bundled dependencies in <root>/node_modules/.vite, resolves that link,
// and keys the cache on a hash that INCLUDES THE ROOT -- so a server raised in
// one worktree finds the cache of another, calls it stale, DELETES it and
// writes its own in its place, under whatever pages the other worktrees are
// serving right now.
//
// Measured, on this desk, with two servers up and traffic on both: over ninety
// seconds of a guard raising and stopping four servers the shared configHash
// went c56c26a6 -> 2ee108e2 -> (absent) -> b56446f9 -> c56c26a6 -> dcd5f463,
// with the metadata file gone entirely for a window each time, and each
// neighbour took a request timeout out of it. Neither neighbour DIED of it --
// that was measured too, and it is why the ports that die are not this file's
// doing -- but a guard that raises a server for every measure was rewriting the
// dependencies of seven other sessions all day long.
//
// So the guard's server keeps its cache OUT of the shared tree, in a directory
// keyed by the real path of this worktree: it is stable across runs, so nothing
// is re-optimised needlessly, and it is nobody else's. E-OPS2 proposed exactly
// this remedy for the build cache -- «keyed by the real path» -- and this is the
// same remedy for the other one.
//
// It is reached with --config rather than by writing anything into the
// worktree: a one-line module that re-exports the delivery's own configuration
// with a cache directory added. The world the guard photographs stays the world
// the repository ships, down to every plugin.
const GUARD_CACHE = join(tmpdir(), 'farfield-quadro',
  createHash('sha1').update(REPO_ROOT).digest('hex').slice(0, 12));

function ownCacheConfig() {
  mkdirSync(GUARD_CACHE, { recursive: true });
  const path = join(GUARD_CACHE, 'vite.guard.config.mjs');
  writeFileSync(path,
    '// Written by tools/guards/lib/quadro.mjs. The delivery\'s own configuration,\n'
    + '// with a dependency cache that is not the one seven other worktrees share.\n'
    + `import delivered from ${JSON.stringify(pathToFileURL(join(REPO_ROOT, 'vite.config.js')).href)};\n`
    + `export default { ...delivered, cacheDir: ${JSON.stringify(join(GUARD_CACHE, '.vite'))} };\n`);
  return path;
}

/**
 * The development server, either one that is already up or one of our own.
 *
 * ITS OWN PORT BY DEFAULT, AND THE REASON IS THE CAMPAIGN'S SHAPE. Eight
 * sessions run at once on eight worktrees and each has a port of its own; a
 * guard that hard-coded one would collide with whichever session happened to be
 * holding it, and a guard that collides is a guard that gets disabled. So it
 * asks the operating system for a free port unless it is told otherwise, and
 * what it starts it stops -- by the exact pid it was handed, never by image.
 *
 * @param {number|null} port  a server to reuse, or null to start one
 */
export async function serveRepo(port = null) {
  if (port && await answers(port)) {
    return { port, borrowed: true, pid: null, async stop() {} };
  }
  const chosen = port || await freePort();
  const child = spawn(process.execPath, [
    join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--port', String(chosen), '--strictPort', '--host', '127.0.0.1',
    '--config', ownCacheConfig(),
  ], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });

  const stop = async () => {
    if (child.exitCode !== null) return;
    // E-OPS5: by the exact pid and its tree, never by image name.
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    await new Promise((settle) => {
      child.once('exit', settle);
      setTimeout(settle, 4000);
    });
  };

  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`vite exited: ${log.slice(-400)}`);
    // eslint-disable-next-line no-await-in-loop
    if (await answers(chosen)) return { port: chosen, borrowed: false, pid: child.pid, stop };
    // eslint-disable-next-line no-await-in-loop
    await new Promise((settle) => { setTimeout(settle, 250); });
  }
  await stop();
  throw new Error(`vite never answered on ${chosen}: ${log.slice(-400)}`);
}

// ---------------------------------------------------------------- the recorder
//
// It is installed with addInitScript, which runs before ANY script of the page,
// so the two prototypes are wrapped before three.js has asked for a context.
// Wrapping the prototype rather than one context means nothing has to know how
// many contexts the page will make, or which one the renderer took.
//
// IT DOES NOT ASK FOR THE STATUS AT LINK TIME, and that is deliberate. Calling
// getProgramParameter(LINK_STATUS) straight after linkProgram forces the driver
// to finish the link there and then, which throws away parallel shader compile
// and turns the arrival into a stall -- the guard would be measuring a page
// nobody else ever loads. It keeps the handles instead and asks at the end,
// when every link has long since finished and the answer costs nothing.
const RECORDER = () => {
  const seen = [];
  const sources = new WeakMap();
  const protos = [];
  if (typeof WebGLRenderingContext !== 'undefined') protos.push(WebGLRenderingContext.prototype);
  if (typeof WebGL2RenderingContext !== 'undefined') protos.push(WebGL2RenderingContext.prototype);
  for (const proto of protos) {
    const shaderSource = proto.shaderSource;
    proto.shaderSource = function recorded(shader, source) {
      sources.set(shader, source);
      return shaderSource.call(this, shader, source);
    };
    const linkProgram = proto.linkProgram;
    proto.linkProgram = function recorded(program) {
      const answer = linkProgram.call(this, program);
      let shaders = [];
      try { shaders = this.getAttachedShaders(program) || []; } catch { shaders = []; }
      seen.push({ gl: this, program, shaders });
      return answer;
    };
  }

  window.__quadroPrograms = () => seen.map((record, index) => {
    const gl = record.gl;
    let alive = false;
    try { alive = gl.isProgram(record.program); } catch { alive = false; }
    const out = { index, alive, linked: null, log: '', stages: [] };
    if (alive) {
      out.linked = !!gl.getProgramParameter(record.program, gl.LINK_STATUS);
      out.log = gl.getProgramInfoLog(record.program) || '';
    }
    for (const shader of record.shaders) {
      const stage = { stage: '?', compiled: null, log: '', uniforms: [], lines: 0 };
      try {
        stage.stage = gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.VERTEX_SHADER
          ? 'vertex' : 'fragment';
        stage.compiled = !!gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        stage.log = gl.getShaderInfoLog(shader) || '';
        const source = sources.get(shader) || '';
        stage.lines = source.split('\n').length;
        // The names only, and never the source: a report that carried four
        // thousand lines of GLSL per program back over the bridge would cost
        // more than the frame it is reporting on. The compiler's own log is
        // what a failure needs, and that comes back whole.
        stage.uniforms = [...source.matchAll(/^\s*uniform\s+\w+\s+(\w+)/gm)].map((m) => m[1]);
      } catch { /* the program was disposed of; `alive` already says so */ }
      out.stages.push(stage);
    }
    return out;
  });

  // WHAT EACH VERTEX STAGE WRITES, AND WHETHER IT USED A GIVEN CALL.
  //
  // WHY THIS EXISTS. Some properties of a shader are invisible in a picture and
  // invisible in a link status too. «The weather multiplies the TINT and never
  // the LAMP» is one, and guard-zone owes it. On the frame it cannot be
  // separated: the bloom, the grade and the tone curve are all non-linear, so
  // the same lamp under a brighter tint lands on a different pixel. Measured on
  // this desk, the near bed's lamp reads 50.98 with the zone as it is and 42.37
  // with it neutralised, and the FAR bed moves the other way, 44.53 -> 46.11 --
  // neither is a lamp being dimmed by the weather, both are the curve.
  //
  // So it is asked of the COMPILED SOURCE -- the exact string the driver was
  // handed, after every chunk had been spliced into it -- and it is asked as a
  // DATAFLOW question rather than as a line of text: for each statement that
  // writes a name, did its right-hand side mention this call? A guard built on
  // that survives any rewrite of the expression, which is the whole of
  // E-IGIENE. What comes back is names and booleans and never the source, for
  // the reason stated above the census.
  window.__quadroWrites = (token) => seen.map((record, index) => {
    const gl = record.gl;
    const out = { index, uniforms: [], varyings: [], writes: [] };
    for (const shader of record.shaders) {
      try {
        if (gl.getShaderParameter(shader, gl.SHADER_TYPE) !== gl.VERTEX_SHADER) continue;
        const source = sources.get(shader) || '';
        out.uniforms = [...source.matchAll(/^\s*uniform\s+\w+\s+(\w+)/gm)].map((m) => m[1]);
        out.varyings = [...source.matchAll(/^\s*(?:varying|out)\s+\w+\s+(\w+)/gm)].map((m) => m[1]);
        const bare = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        for (const statement of bare.split(';')) {
          const m = /(?:^|[\s{}()])([A-Za-z_]\w*)\s*(\*=|\+=|-=|\/=|=)(?!=)([\s\S]*)$/.exec(statement);
          if (!m) continue;
          out.writes.push({ lhs: m[1], op: m[2], uses: m[3].includes(token) });
        }
      } catch { /* the program was disposed of */ }
    }
    return out;
  });

  // THE INJECTION SEAT, for the guard's own self test. It compiles a throwaway
  // program on a throwaway context -- the app's own context is never touched --
  // and because the prototype is what is wrapped, the recorder picks it up like
  // any other. `duplicate` puts one uniform in twice, which is the exact defect
  // E-LUCE5 shipped.
  window.__quadroInject = (duplicate) => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    const twice = duplicate ? 'uniform vec3 uAirPale;\n' : '';
    const vertex = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertex, '#version 300 es\nin vec3 p;\nvoid main(){gl_Position=vec4(p,1.0);}\n');
    gl.compileShader(vertex);
    const fragment = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragment, `#version 300 es\nprecision highp float;\nuniform vec3 uAirPale;\n${twice}out vec4 c;\nvoid main(){c=vec4(uAirPale,1.0);}\n`);
    gl.compileShader(fragment);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    return true;
  };
};

// The pose the whole campaign judges this world on: POSE_TARGET of
// src/core/poses.js, in FIRST person. It is written here as numbers rather than
// imported because the browser cannot import the module, and the guard checks
// it against the module so the two can never drift apart.
export const POSE_P = { x: 0.599, y: 1.583, z: 14.215, yaw: 1.818, pitch: 4.124, fov: 44.199 };

const TIER_OF_CHOICE = { alta: 'alto', media: 'medio', bassa: 'basso' };

/**
 * The world, loaded, calibrated to a tier, and stood on the pose.
 *
 * @param {object} how  port, viewport, tier and how long to wait for the ground
 */
export async function openWorld({
  chromium, port, width = 960, height = 540, tier = 'alta', groundTimeoutMs = 180000,
}) {
  const browser = await chromium.launch({
    headless: true,
    // The real driver and not the software rasterizer: a compile is a DRIVER's
    // answer, and SwiftShader's answer is a different compiler's. Which one
    // actually turned up is reported, so a run that fell back says so.
    args: ['--use-angle=d3d11', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript(RECORDER);

  const noise = [];
  page.on('pageerror', (error) => noise.push(error.message.slice(0, 300)));
  page.on('console', (message) => {
    if (message.type() === 'error') noise.push(message.text().slice(0, 300));
  });

  const world = {
    page,
    noise,
    width,
    height,
    driver: 'unknown',
    async tierId() { return page.evaluate(() => window.farfield.quality.tier.id); },
    async stats() { return page.evaluate(() => window.farfield.renderer.stats()); },
    async programs() { return page.evaluate(() => window.__quadroPrograms()); },
    async writes(token) { return page.evaluate((t) => window.__quadroWrites(t), token); },
    async inject(duplicate) { return page.evaluate((d) => window.__quadroInject(d), duplicate); },
    async children() {
      return page.evaluate(() => window.farfield.scene.children.map((c) => c.name || '(anon)'));
    },
    async stand(turnDeg) { return stand(page, turnDeg); },
    async show(hidden, keepOnly = null) { return show(page, hidden, keepOnly); },
    async close() { await browser.close(); },
  };

  // ANYTHING THAT THROWS IN HERE TAKES THE BROWSER WITH IT. A world that fails
  // to arrive is a guard that fails, and a guard that fails must not also leave
  // a headless chromium holding a GPU behind it: eight sessions share this
  // machine and the first thing that happens after a red run is another run.
  try {
    await page.goto(`http://127.0.0.1:${port}/?dev&t0&intro=0`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => window.farfield && window.farfield.hub && window.farfield.hub.groundReady(),
      null, { timeout: groundTimeoutMs, polling: 250 },
    );
    await page.evaluate((choice) => window.farfield.quality.setChoice(choice), tier);
    await page.waitForFunction(
      (want) => window.farfield.quality.tier.id === want, TIER_OF_CHOICE[tier] || 'medio',
      { timeout: 30000, polling: 200 },
    );

    // THE ROUND OF FRAMES, AND WHY IT IS NOT ONE. The meadow streams in over
    // seconds and half the programs of this world are compiled the first time
    // the thing they draw is on screen; a probe taken on the frame after
    // groundReady reports a world that is still arriving. Two settles with the
    // pose set on both sides of them is what it took, measured, for the census
    // to stop moving.
    await page.evaluate(() => {
      for (const selector of ['#ui', '.dev-hud', '.dev-panel', '.overlay-start']) {
        for (const node of document.querySelectorAll(selector)) node.style.display = 'none';
      }
    });
    await stand(page, 0);
    await page.waitForTimeout(2500);
    await stand(page, 0);
    await page.waitForTimeout(1200);

    world.driver = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
  } catch (error) {
    await browser.close().catch(() => {});
    const said = noise.length ? ` -- the page said: ${noise.slice(0, 2).join(' | ')}` : '';
    throw new Error(`${error.message}${said}`);
  }

  return world;
}

/** The pose, in first person, turned by so many degrees off its own bearing. */
async function stand(page, turnDeg) {
  await page.evaluate(({ pose, turn }) => {
    window.farfield.player.placePerson('prima');
    window.setDevPose({ ...pose, yaw: pose.yaw + turn });
  }, { pose: POSE_P, turn: turnDeg });
}

/**
 * Which children of the scene are drawn for the next plate.
 *
 * By the child of the scene and by its NAME, which is the coarsest handle there
 * is and the only one that is not a reach into somebody's layer. The avatar is
 * left exactly where the frame put it: in first person the world hides it, and
 * a guard that forced it back on would be photographing a world nobody sees.
 */
async function show(page, hidden, keepOnly) {
  await page.evaluate(({ off, only }) => {
    for (const child of window.farfield.scene.children) {
      const name = child.name || '';
      if (name.startsWith('v8-avatar')) continue;
      if (only) child.visible = only.includes(name);
      else child.visible = !off.includes(name);
    }
  }, { off: hidden || [], only: keepOnly });
}

/**
 * One plate: the frame as it stands, in raw pixels.
 *
 * @returns {{data: Buffer, channels: number, width: number, height: number}}
 */
export async function plate(world, sharp, { turnDeg = 0, settleMs = 450 } = {}) {
  await world.stand(turnDeg);
  await world.page.waitForTimeout(settleMs);
  const png = await world.page.screenshot({ type: 'png' });
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  return { data, channels: info.channels, width: info.width, height: info.height };
}

/**
 * How much of a horizontal band of two plates disagrees.
 *
 * This is the whole trick of the smoke, and it is why the smoke does not have
 * to know what the sky looks like. Take the frame; take the frame again with
 * one family of the world switched off; every pixel that MOVED is a pixel that
 * family was drawing. Nothing about the colour of the sky, the hour, the grade
 * or the tier enters into it -- a family that draws nothing moves nothing, and
 * that is the defect E-LUCE5 shipped.
 *
 * @param {number} floor  how far apart, in summed channel steps out of 765, two
 *                        pixels have to be before they count as different
 */
export function bandDiff(a, b, band, floor = 12) {
  const { width, height, channels } = a;
  const from = Math.round(band[0] * height);
  const to = Math.round(band[1] * height);
  let moved = 0;
  let total = 0;
  for (let y = from; y < to; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const gap = Math.abs(a.data[i] - b.data[i])
        + Math.abs(a.data[i + 1] - b.data[i + 1])
        + Math.abs(a.data[i + 2] - b.data[i + 2]);
      total++;
      if (gap > floor) moved++;
    }
  }
  return total ? moved / total : 0;
}

/** What a band of one plate is worth in light, which is how a black one is caught. */
export function bandLuma(a, band) {
  const { width, height, channels } = a;
  const from = Math.round(band[0] * height);
  const to = Math.round(band[1] * height);
  let sum = 0;
  let count = 0;
  let low = 255;
  let high = 0;
  for (let y = from; y < to; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const value = 0.2126 * a.data[i] + 0.7152 * a.data[i + 1] + 0.0722 * a.data[i + 2];
      sum += value;
      count++;
      if (value < low) low = value;
      if (value > high) high = value;
    }
  }
  return { mean: count ? sum / count : 0, min: low, max: high };
}
