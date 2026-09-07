import { createHash } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';
import { MONOLITHS } from '../../src/world/layout.js';
import { ZONE } from '../../src/world/voxel/campo.js';
import {
  LUMA_FLOOR, SEATS, blockDistance, blockTerm, lawAt, paintZone, readResidual, residualAt,
} from '../zone/paint-zone.mjs';
import { read, reporter, selfTest, REPO_ROOT } from './lib.mjs';

// GUARD-ZONE -- THE LIGHT BY PLACE, AND THE DARK AT THE FOOT OF THE BLOCKS.
//
// ===========================================================================
// WHAT THIS GUARD IS FOR, IN ONE SENTENCE: this world's meadow varies by PLACE
// now, and it does so through exactly one picture read by exactly four
// programs -- the day any of those four stops reading it, a band of shade has
// flowers standing in it at open-meadow brightness, and nothing else in the
// campaign would notice.
//
// THE THREE THINGS IT HOLDS.
//
//   THE TERM. Five sentences of GLSL: one multiply on the FINISHED light in the
//     field, and one on the tint (never on the glow) in each of the three
//     programs of the vegetation. They are matched as text because there is no
//     way to ask a compiled shader whether it still believes the ground has
//     weather, and each is the exact line a tidying-up deletes.
//
//   THE MAP. The delivered picture is repainted from its own sources -- the
//     seats of the world, the residual measured off the reference, and the
//     light chain that carries a luma into a light -- and compared BYTE FOR
//     BYTE against what ships. That is what makes the asset a function of the
//     world rather than a file somebody once made: move a block, move the seal,
//     move the grade cube, and this goes red instead of the meadow going
//     quietly wrong.
//
//   THE FOOT. Per block, on the map itself: how deep the dark at the foot goes
//     and how far it reaches, against R1 §1.7's own three to five metres.
//
// AND WHAT IT DELIBERATELY DOES NOT GATE is the decile of the frame, which is
// the campaign's headline reading of this meadow and is NOT this unit's alone
// to close. It is printed every run, with its number and its owners, for the
// reason guard-prato states at its own head: a gate on a number a session
// cannot move is a gate that gets disabled.
//
// IT RUNS UNDER PLAIN NODE, like guard-prato and guard-scala, because a reading
// that needs a browser belongs to the session gate and this one has to be
// askable at every commit.

const CAMPO = 'src/world/voxel/campo-material.js';
const VEGETATION = 'src/world/vegetation.js';
const SHIPPED = join(REPO_ROOT, 'assets-src', 'materia', 'zone-shade.png');

// ---------------------------------------------------------------- the shape
const SHAPE = [
  {
    file: CAMPO,
    what: 'the field reads the ground’s own zone in XZ, through the one seat',
    re: /float\s+zoneAt\(vec2\s+xz\)\s*\{\s*vec2\s+uv\s*=\s*\(xz\s*-\s*uZone\.xy\)\s*\*\s*uZone\.z\s*;/,
  },
  {
    file: CAMPO,
    what: 'and multiplies the FINISHED light by it, not the sun alone',
    re: /light\s*\*=\s*zoneAt\(hit\.p\.xz\)\s*;/,
  },
  {
    file: CAMPO,
    what: 'the delivery lands in one seat and reaches every program that asked',
    re: /export\s+function\s+setZoneMap\(texture\)\s*\{[\s\S]*?for\s*\(const\s+u\s+of\s+zoneBound\)\s+u\.value\s*=\s*texture\s*;/,
  },
  {
    file: VEGETATION,
    what: 'the sprays stand in the same weather as the ground under them',
    re: /vTint\s*=\s*light\s*\*\s*aParams\.w\s*\*\s*zoneAt\(world\.xz\)\s*;/,
  },
  {
    file: VEGETATION,
    what: 'and so do the near flowers',
    re: /vTint\s*\*=\s*zoneAt\(world\.xz\)\s*;/,
  },
  {
    file: VEGETATION,
    what: 'and the far ones',
    re: /vTint\s*=\s*head\s*\*\s*aLook\.y\s*\*\s*zoneAt\(aFlower\.xz\)\s*;/,
  },
  {
    file: VEGETATION,
    what: 'and the zone is on the tint and never on the lamp, which is a source',
    re: /vEmit\s*=\s*halo\s*;/,
    absent: /vEmit\s*=\s*halo\s*\*\s*zoneAt/,
  },
];

// ------------------------------------------------------------- the foot
//
// WHAT R1 §1.7 MEASURED AND WHAT IS GATED HERE. On the reference, at the fitted
// pose, the meadow is dark for THREE TO FIVE METRES round the foot of a block
// and equally dark on all three sides of it. Read on the plane the same field
// stands at 0.65 of its own far meadow two metres out and is home by five and a
// half. So the two numbers a block owes the ground are how DEEP it goes and how
// FAR it reaches, and both are read off the delivered map rather than off the
// literals -- a strength that survived and a residual that undid it is a foot
// that is not there.
const FOOT_DEPTH = [0.55, 0.80];        // the factor the law draws at contact
const FOOT_REACH = [3.0, 5.0];          // metres, R1 §1.7's own three to five
const FOOT_TOLERANCE = 0.5;             // and the ±0,5 m the mandate carries
// AND WHAT THE DELIVERED MAP HAS TO SHOW AT A FOOT, absolutely: the two metres
// round a footprint stand at most this share of open meadow.
//
// It is a gate on the DELIVERY and not on the law. A residual cannot undo the
// law -- the map is clamped at one, so a knot of any size leaves a foot at
// whatever the law drew -- but a floor, a clamp or a frame that had drifted
// would leave every literal above exactly where it is and still ship a foot
// that is not there. 0.88 is just under what the law alone draws at the
// shallowest of the six (0.87 at block 01, where the reference's own weather
// is already pale).
const FOOT_ON_MAP = 0.88;

/**
 * ONE BLOCK'S OWN TERM, walked OUT from its footprint: how deep at contact and
 * where it is home.
 *
 * The walk is in the distance to the FOOTPRINT and not to the centre, because a
 * block is a rectangle and a ring at a fixed radius from its middle stands two
 * metres off one face and half a metre off another. And it is the BLOCK'S term
 * and not the whole law, because a tree or a boulder on the same bearing would
 * come back inside the reading as if the block had drawn it.
 */
function footProfile(block) {
  const a = (block.rotationY + 90) * Math.PI / 180;      // out along one face
  let contact = 1;
  let reach = 0;
  let nearest = Infinity;
  for (let step = 0; step <= 400; step++) {
    const r = step * 0.05;
    const x = block.position.x + Math.cos(a) * r;
    const z = block.position.z + Math.sin(a) * r;
    const d = blockDistance(x, z, block);
    const v = blockTerm(x, z, block);
    if (d < nearest) { nearest = d; contact = v; }
    if (v < 0.98) reach = Math.max(reach, d);
  }
  return { contact, reach };
}

/**
 * AND THE MAP AT A FOOT AGAINST THE MAP AWAY FROM IT, per bearing.
 *
 * This is the delivered picture and not the law, and it is the reading that
 * catches the failure the law alone cannot: a residual that quietly undid the
 * foot, so that the literals still say 0.32 over 5.4 m and the ground under a
 * block is open meadow.
 *
 * READ ABSOLUTELY AND NOT AGAINST A FAR RING. The first cut of this compared
 * the two metres at a foot against the meadow six to nine metres out, which is
 * exactly the reading that fails on block 06: it stands behind the spawn, where
 * the reference never looked and the residual is one, while its own far ring
 * reaches back into ground the residual does darken. The far meadow of a block
 * is not a constant, so the gate is the near ring itself.
 *
 * FOUR SECTORS AND NOT ONE, and the sun is the reason. R1 §1.7 is explicit that
 * the reference is EQUALLY dark on all sides of a block -- west 35, front 39,
 * east 30 at block 01 -- where the seal's own sun (azimuth 280, 47 degrees up)
 * would have laid a five metre shadow to the east and nothing at all to the
 * west. So the spread between the four is printed and gated wide: weather may
 * lean over a foot, a cast shadow may not fall on one side of it.
 */
function footOnMap(block, res) {
  const sectors = [0, 90, 180, 270].map(() => ({ near: [], far: [] }));
  for (let deg = 0; deg < 360; deg += 5) {
    const a = deg * Math.PI / 180;
    const s = sectors[Math.floor(((deg + 45) % 360) / 90)];
    for (let step = 0; step <= 240; step++) {
      const r = step * 0.05;
      const x = block.position.x + Math.cos(a) * r;
      const z = block.position.z + Math.sin(a) * r;
      const d = blockDistance(x, z, block);
      const v = Math.max(LUMA_FLOOR, Math.min(1, lawAt(x, z) * residualAt(res, x, z)));
      if (d > 0.2 && d < 2.5) s.near.push(v);
    }
  }
  const mean = (v) => (v.length ? v.reduce((t, x) => t + x, 0) / v.length : NaN);
  const per = sectors.map((s) => mean(s.near)).filter(Number.isFinite);
  return {
    mean: per.reduce((t, x) => t + x, 0) / per.length,
    lo: Math.min(...per),
    hi: Math.max(...per),
  };
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

async function main() {
  const r = reporter('guard-zone -- the light by place, and the dark at the foot of the blocks');
  const source = { [CAMPO]: read(CAMPO), [VEGETATION]: read(VEGETATION) };

  r.line('');
  r.line('  THE TERM, read off the four programs that carry it:');
  for (const { file, what, re, absent } of SHAPE) {
    r.check(re.test(source[file]) && !(absent && absent.test(source[file])), what);
  }

  // --------------------------------------------------------------- the map
  r.line('');
  r.line('  THE MAP IS THE PAINTER’S, repainted here and compared byte for byte:');
  const { map, lo, hi, lumaLo } = await paintZone();
  const shipped = await sha1OfShipped();
  const painted = sha(Buffer.from(map));
  r.check(shipped !== null, 'the delivered picture is there to be compared',
    shipped === null ? `${SHIPPED} is missing` : '');
  if (shipped !== null) {
    r.check(shipped === painted,
      'and it is exactly what these sources paint',
      `delivered ${shipped}, painted ${painted}`);
  }
  r.line(`    in light it runs ${lo.toFixed(3)} to ${hi.toFixed(3)}; `
    + `in luma, through the chain, ${lumaLo.toFixed(3)} to 1.000`);

  // THE RIM, and it is the one failure that would be invisible: everything
  // outside the square reads the edge, so a rim off one dims four hundred
  // metres of boundary and nothing in this world would say so.
  let rim = 255;
  for (let k = 0; k < ZONE.side; k++) {
    rim = Math.min(rim, map[k], map[(ZONE.side - 1) * ZONE.side + k],
      map[k * ZONE.side], map[k * ZONE.side + ZONE.side - 1]);
  }
  r.check(rim >= 250, 'the rim of the square is open meadow, so the world outside it is',
    `${rim} of 255`);

  // AND IT HAS TO DO SOMETHING. A picture of solid 255 passes every other gate
  // in this campaign, because a term that multiplies by one breaks nothing.
  const dark = map.reduce((t, v) => t + (v < 230 ? 1 : 0), 0) / (ZONE.side * ZONE.side);
  r.check(dark > 0.05, 'and some of the plateau actually stands in a zone',
    `${(dark * 100).toFixed(1)}% under 0.90 of open meadow`);

  // ------------------------------------------------------------- the foot
  const res = readResidual();

  r.line('');
  r.line('  THE DARK AT THE FOOT, per block, read off the law and off the map:');
  for (const block of MONOLITHS) {
    const { contact, reach } = footProfile(block);
    const ok = reach >= FOOT_REACH[0] - FOOT_TOLERANCE
      && reach <= FOOT_REACH[1] + FOOT_TOLERANCE
      && contact >= FOOT_DEPTH[0] && contact <= FOOT_DEPTH[1];
    r.check(ok, `block ${block.id} stands in its own dark`,
      `${contact.toFixed(2)} at contact, home by ${reach.toFixed(1)} m`);
    const { mean: sMean, lo: sLo, hi: sHi } = footOnMap(block, res);
    r.check(sMean <= FOOT_ON_MAP && sHi / sLo < 1.6,
      `and the delivered map still has it, on every side of ${block.id}`,
      `the near two metres stand at ${sMean.toFixed(2)} of open meadow, `
      + `${sLo.toFixed(2)} to ${sHi.toFixed(2)} by sector`);
  }

  // AND THE LAW CANNOT KNOW WHERE THE SUN IS, which is the whole of B-6 and of
  // E-SINTESI-DIVARIO D5/D6 made into an assertion. A directional term would
  // pass every reading above -- it would be dark at the foot and three to five
  // metres wide -- and would put a five metre tongue to the east of every block
  // that the reference does not have.
  const painterCode = read('tools/zone/paint-zone.mjs')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  r.check(!/sun|azimuth|elevation|SunDir/i.test(painterCode),
    'and the law is blind to the sun: there is no cast shadow anywhere in it');

  // ---------------------------------------------------------- the residual
  r.line('');
  r.line('  THE RESIDUAL, which is a measurement and has to say where it came from:');
  r.check(Boolean(res.fitted && res.fitted.on),
    'it says what it was fitted on', res.fitted ? res.fitted.on : 'nothing stated');
  r.check(res.cell <= 2 && res.cell >= 1,
    'and its knots stand at the scale a zone has structure at (R1 §1.6)',
    `${res.cell} m`);
  const knots = res.knots.filter((v) => v < 0.999);
  r.check(knots.length > 200 && Math.min(...knots) < 0.6,
    'and it carries the reference’s own dark places and not a flat sheet',
    `${knots.length} knots under one, deepest ${Math.min(...knots).toFixed(3)}`);
  r.check(res.knots.every((v) => v >= LUMA_FLOOR - 1e-9 && v <= 1.35 + 1e-9),
    'and no knot is outside the range the fit is allowed',
    `${Math.min(...res.knots).toFixed(3)} to ${Math.max(...res.knots).toFixed(3)}`);

  // ------------------------------------------------------- and the witness
  r.line('');
  r.line('  WITNESS, not gated -- the factor of the frame at the fitted pose:');
  r.line('    the reference’s zone decile (R1 §1.6)      0.31');
  r.line('    ours before this unit                       0.56');
  r.line('    ours after                                  0.43');
  r.line('    cells under half the bright: reference 17%, before 2%, after 10%');
  r.line('    semivariance at four metres: reference 0.073, before 0.025, after 0.042');
  return r;
}

async function sha1OfShipped() {
  try {
    // ONE BAND OUT, and it has to be asked for: sharp promotes a grey PNG to
    // three identical channels on the raw path, and a hash of that is a hash of
    // a picture nobody delivered.
    const { data, info } = await sharp(SHIPPED).toColourspace('b-w').raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 1 || info.width !== ZONE.side) return `shape ${info.width}x${info.channels}`;
    return sha(data);
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- self-test
function self() {
  const source = { [CAMPO]: read(CAMPO), [VEGETATION]: read(VEGETATION) };
  const breaks = (file, from, to) => {
    const patched = { ...source, [file]: source[file].replace(from, to) };
    return SHAPE.filter(({ file: f, re, absent }) => !re.test(patched[f])
      || (absent && absent.test(patched[f]))).length > 0;
  };
  const cases = [
    {
      what: 'the field back to multiplying the SUN alone (R1 S3 as written)',
      caught: breaks(CAMPO, /light\s*\*=\s*zoneAt\(hit\.p\.xz\)\s*;/, 'sun *= zoneAt(hit.p.xz);'),
    },
    {
      what: 'the term taken out of the field altogether',
      caught: breaks(CAMPO, /light\s*\*=\s*zoneAt\(hit\.p\.xz\)\s*;/, ''),
    },
    {
      what: 'the delivery no longer reaching the programs that asked first',
      caught: breaks(CAMPO, /for\s*\(const\s+u\s+of\s+zoneBound\)\s+u\.value\s*=\s*texture\s*;/,
        'zoneBound.length = 0;'),
    },
    {
      what: 'the far flowers standing at open-meadow brightness in a dark band',
      caught: breaks(VEGETATION, /vTint\s*=\s*head\s*\*\s*aLook\.y\s*\*\s*zoneAt\(aFlower\.xz\)\s*;/,
        'vTint = head * aLook.y;'),
    },
    {
      what: 'the near flowers likewise',
      caught: breaks(VEGETATION, /vTint\s*\*=\s*zoneAt\(world\.xz\)\s*;/, ''),
    },
    {
      what: 'the sprays likewise',
      caught: breaks(VEGETATION, /vTint\s*=\s*light\s*\*\s*aParams\.w\s*\*\s*zoneAt\(world\.xz\)\s*;/,
        'vTint = light * aParams.w;'),
    },
    {
      what: 'a night lamp dimmed by the day’s weather',
      caught: breaks(VEGETATION, /vEmit\s*=\s*halo\s*;/, 'vEmit = halo * zoneAt(world.xz);'),
    },
    {
      // THE MAP AND ITS SOURCES, injected the only way that matters: move a
      // block and see whether the delivered picture is still the painter's.
      what: 'a block moved with the map left where it was',
      caught: (() => {
        const kept = { ...MONOLITHS[0].position };
        MONOLITHS[0].position.x += 4;
        const moved = sha(Buffer.from(paintSync()));
        MONOLITHS[0].position.x = kept.x;
        return moved !== sha(Buffer.from(paintSync()));
      })(),
    },
    {
      what: 'the residual flattened to a sheet of ones',
      caught: (() => {
        const flat = readResidual().knots.map(() => 1).filter((v) => v < 0.999);
        return !(flat.length > 200 && Math.min(...flat, 1) < 0.6);
      })(),
    },
    {
      // AND THE ONE A RESIDUAL CAN STILL DO, which is to run past the range the
      // fit is allowed. It cannot undo the law -- the map is clamped at one, so
      // a knot of any size leaves the foot at whatever the law drew -- but a
      // knot outside the range is a fit that was not a fit.
      what: 'the residual run past the ceiling the fit allows',
      caught: (() => {
        const knots = readResidual().knots.map((v) => v * 2);
        return !knots.every((v) => v >= LUMA_FLOOR - 1e-9 && v <= 1.35 + 1e-9);
      })(),
    },
    {
      what: 'the law of the blocks turned off',
      caught: (() => {
        const kept = SEATS.block.strength;
        SEATS.block.strength = 0;
        const { contact } = footProfile(MONOLITHS[0]);
        SEATS.block.strength = kept;
        return !(contact >= FOOT_DEPTH[0] && contact <= FOOT_DEPTH[1]);
      })(),
    },
    {
      what: 'and its reach stretched past what R1 measured',
      caught: (() => {
        const kept = SEATS.block.reach;
        SEATS.block.reach = 12;
        const { reach } = footProfile(MONOLITHS[0]);
        SEATS.block.reach = kept;
        return reach > FOOT_REACH[1] + FOOT_TOLERANCE;
      })(),
    },
  ];
  selfTest('guard-zone', cases);
}

/** The law and the residual only, for an injection that must not touch the chain. */
function paintSync() {
  const res = readResidual();
  const out = new Uint8Array(ZONE.side * ZONE.side);
  const span = ZONE.side * ZONE.cell;
  for (let j = 0; j < ZONE.side; j++) {
    const z = ZONE.centre.z - span / 2 + (j + 0.5) * ZONE.cell;
    for (let i = 0; i < ZONE.side; i++) {
      const x = ZONE.centre.x - span / 2 + (i + 0.5) * ZONE.cell;
      out[j * ZONE.side + i] = Math.round(
        Math.max(LUMA_FLOOR, Math.min(1, lawAt(x, z) * residualAt(res, x, z))) * 255,
      );
    }
  }
  return out;
}

if (process.argv.includes('--self')) {
  self();
} else {
  const r = await main();
  r.note('IL FATTORE AL DECILE DEL FOTOGRAMMA NON E’ GATEATO QUI, e questo e’ il '
    + 'numero: alla posa fittata il campo sta a 0,43 contro lo 0,31 del bersaglio '
    + '(era 0,56). Le zone hanno chiuso quello che una mappa lenta puo’ chiudere -- '
    + 'misurato alla SCALA DELLA ZONA (la mappa sfocata a un metro e mezzo, sul '
    + 'supporto che i due quadri hanno in comune) il decile va da 0,551 a 0,520 '
    + 'contro lo 0,449 del bersaglio -- e cio’ che resta e’ di CONTRASTO e non di '
    + 'zona: il bersaglio crudo sta a 0,314 dove il proprio campo lento sta a 0,449, '
    + 'cioe’ un terzo del suo divario vive SOTTO il metro e mezzo, dove nessuna '
    + 'mappa di zone arriva. Quella voce e’ l’occlusione fra filo e filo (U-CAMPO-2) '
    + 'e la prospettiva aerea sul campo lontano (R6). Proprietari: U-CAMPO-2 e il '
    + 'coordinatore.');
  r.end('the map is the painter’s, and the four programs read it');
}
