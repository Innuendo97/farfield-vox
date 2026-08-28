import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(TOOLS_DIR, '..');

const MANIFEST = join(TOOLS_DIR, 'bin', 'toolchain.json');
const SETUP_HINT = 'run "npm run setup:tools" first';

export function loadToolchain() {
  if (!existsSync(MANIFEST)) {
    throw new Error(`toolchain not installed (${MANIFEST} is missing).\n${SETUP_HINT}`);
  }
  return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

export function requireTool(name) {
  const toolchain = loadToolchain();
  const entry = toolchain[name];
  const exe = entry && entry.exe;
  if (!exe || !existsSync(exe)) {
    throw new Error(`"${name}" is not installed.\n${SETUP_HINT}`);
  }
  return exe;
}

// External tools run in the foreground with inherited stdio: their own output
// is the only useful diagnostic when a bake or an encode fails.
export function run(exe, args, options = {}) {
  const result = spawnSync(exe, args, { stdio: 'inherit', shell: false, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${exe} exited with code ${result.status}`);
  }
  return result;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
