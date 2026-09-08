import { spawnSync } from 'node:child_process';
import {
  copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { REPO_ROOT, reporter, selfTest } from './lib.mjs';

// ONE SUN, INHERITED INTO THE ROUND.
//
// tools/lighting/check-suns.mjs is older than this directory and is the guard
// that would have caught a world lit by two suns fifty two degrees apart for a
// whole campaign. It stays where it is -- everything that bakes or lights runs
// it first, and it has to be reachable without the suite -- so this is a wrapper
// and not a copy. A second implementation of it would be a second opinion about
// where the sun is, which is the defect it exists for.
//
// BOTH RUNS, because they make different claims. The plain run asks every
// consumer, including the delivered light maps that still carry the old sun
// under a declared waiver. --sources asks only the seats that will AUTHOR the
// next bake, which is the smaller claim and the one that has to stay true while
// eight sessions re-author what they own.
//
// ==========================================================================
// AND IT HAS A --self NOW, WHICH IS THE RESIDUE U-GUARDIA-3 LEFT WITH A PRICE
// WRITTEN ON IT.
//
// That unit found this the one file in tools/guards/ with no self test at all,
// and could not close it: check-suns.mjs resolved the seat, the roster of
// waivers and every consumer's manifest from the repository root, so the only
// way to make it say no was to write a defect into a file this unit does not
// own. It wrote down what the fix would cost -- «a root passed as an argument,
// and then the injection here is four lines and a temporary directory» -- and
// named the owner.
//
// This is that, and the argument is the only thing U-GUARDIA-4 changed in
// check-suns.mjs. Each case below builds a TREE OF ITS OWN under the machine's
// temporary directory: copies of the six files the check reads, one of them
// bent, and check-suns.mjs pointed at it with --root. Nothing in the delivery
// is ever opened for writing, so there is no window in which a crash leaves a
// bent seal on disk -- which was the second half of U-GUARDIA-3's objection and
// not only the first.
//
// THE COPIES ARE THE DELIVERY'S OWN FILES and not stand-ins written here. A
// stand-in would be this guard's opinion of what a seat looks like, and the
// first case proves the point by asserting that the UNBENT tree passes: if what
// we build were not what ships, every «caught» after it would be catching our
// own carpentry.
// ==========================================================================

const CHECK = 'tools/lighting/check-suns.mjs';

/** The six doors check-suns.mjs goes through, and therefore the whole tree. */
const DOORS = [
  'assets-src/sky/sky.json',
  'tools/lighting/sun-waivers.json',
  'tools/lighting/sun.py',
  'tools/clouds/cloud-pieces.mjs',
  'assets-src/clouds/plates.json',
  'assets-src/terrain/terrain.json',
];

/**
 * A tree of copies, with one file bent by the caller, and what the check says.
 *
 * @param {(root: string) => void} bend what to do to the copies, or nothing
 * @returns {{status: number, text: string}}
 */
function askAbout(bend = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'guard-suns-'));
  try {
    for (const door of DOORS) {
      mkdirSync(join(root, dirname(door)), { recursive: true });
      copyFileSync(join(REPO_ROOT, door), join(root, door));
    }
    bend(root);
    const run = spawnSync(process.execPath, [join(REPO_ROOT, CHECK), `--root=${root}`], {
      cwd: REPO_ROOT, encoding: 'utf8',
    });
    return { status: run.status, text: `${run.stdout ?? ''}${run.stderr ?? ''}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const editJson = (root, rel, change) => {
  const path = join(root, rel);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  change(value);
  writeFileSync(path, JSON.stringify(value, null, 2));
};

const withoutWaiver = (consumer) => (roster) => {
  roster.waivers = roster.waivers.filter((w) => w.consumer !== consumer);
};

if (process.argv.includes('--self')) {
  // Taken once and read against by every other case: it is both the control and
  // the proof that the tree we build is the tree that ships.
  const honest = askAbout();
  // The Python door only answers on a machine that has an interpreter. Blender
  // brings its own and is where sun.py actually runs, so a desk without one is
  // told rather than failed; the case that bends sun.py says so in its own name
  // instead of reporting a pass it did not earn.
  const python = /sun\.py and sun\.mjs give the same direction/.test(honest.text);

  selfTest('guard-suns', [
    {
      what: 'the tree of copies IS the delivery: unbent, the check says yes to it',
      caught: honest.status === 0,
    },
    {
      what: 'the seat\'s vector turned away from its own two angles -- the leg no waiver reaches',
      caught: askAbout((root) => editJson(root, 'assets-src/sky/sky.json', (sky) => {
        sky.day.sun.vector = [0.5, 0.5, -0.7071];
      })).status !== 0,
    },
    {
      what: 'and the preset walked outside the bar the fit input publishes for itself',
      caught: askAbout((root) => editJson(root, 'assets-src/sky/sky.json', (sky) => {
        sky.day.sun.azimuth += 40;
        delete sky.day.sun.vector;
      })).status !== 0,
    },
    {
      what: 'the sun of the two-sun world put back in the seat: elevation 34, azimuth -9.5',
      caught: askAbout((root) => editJson(root, 'assets-src/sky/sky.json', (sky) => {
        sky.day.sun = { elevation: 34, azimuth: -9.5 };
      })).status !== 0,
    },
    {
      what: 'a waiver naming a consumer this check never presents, which is a hole in waiver\'s clothes',
      caught: askAbout((root) => editJson(root, 'tools/lighting/sun-waivers.json', (roster) => {
        roster.waivers.push({
          consumer: 'assets-src/rocks/rocks-bake.json', owner: 'nobody', note: 'a typo',
        });
      })).status !== 0,
    },
    {
      what: 'a consumer that disagrees with the seat and is NOT declared: the ground, undeclared',
      caught: askAbout((root) => editJson(root, 'tools/lighting/sun-waivers.json',
        withoutWaiver('assets-src/terrain/terrain.json'))).status !== 0,
    },
    {
      what: 'and one that AGREES is not failed for having no waiver: the same, brought to the seat',
      caught: askAbout((root) => {
        const { sun } = JSON.parse(readFileSync(join(root, 'assets-src/sky/sky.json'), 'utf8')).day;
        editJson(root, 'tools/lighting/sun-waivers.json',
          withoutWaiver('assets-src/terrain/terrain.json'));
        editJson(root, 'assets-src/terrain/terrain.json', (t) => {
          t.sun.elevation = sun.elevation;
          t.sun.bearing = sun.azimuth;
        });
      }).status === 0,
    },
    {
      what: 'the cloud generator carrying a sun of its own, with its waiver lifted',
      caught: askAbout((root) => editJson(root, 'tools/lighting/sun-waivers.json',
        withoutWaiver('tools/clouds/cloud-pieces.mjs'))).status !== 0,
    },
    {
      what: python
        ? 'the two languages made to disagree: sun.py reading the bearing with the other sign'
        : 'the two languages: NOT ASKED, no python on this desk (Blender brings its own)',
      caught: !python || askAbout((root) => {
        const path = join(root, 'tools/lighting/sun.py');
        const source = readFileSync(path, 'utf8');
        // The bearing read as its own negative: the same arithmetic with one
        // sign out, which is the shape the compass defect of U-CORNICE-2 came
        // in and the shape a second implementation drifts in.
        writeFileSync(path, source.replace(/^def sun_direction\(/m,
          'def sun_direction(elevation, bearing):\n'
          + '    return _sun_direction(elevation, -bearing)\n\n\n'
          + 'def _sun_direction('));
      }).status !== 0,
    },
  ]);
}

const report = reporter('guard-suns -- one sun, and every consumer of it declared');

for (const args of [[], ['--sources']]) {
  const run = spawnSync(process.execPath, [join(REPO_ROOT, CHECK), ...args], {
    cwd: REPO_ROOT, encoding: 'utf8',
  });
  const tail = (run.stdout ?? '').trim().split('\n').at(-1) ?? '';
  report.check(run.status === 0, `${CHECK} ${args.join(' ')}`.trim(), tail.trim());
  if (run.status !== 0) process.stdout.write(`${run.stdout}${run.stderr}`);
}

report.end();
