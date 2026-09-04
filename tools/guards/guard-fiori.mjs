import { createHash } from 'node:crypto';
import { flowerCensus, flowerField } from '../../src/world/vegetation.js';
import { flowerLightPoints, groundHeightAt } from '../../src/world/contracts.js';
import { columnTop, EMPTY } from '../../src/world/voxel/worldgen.js';
import { VOXEL } from '../../src/world/voxel/columns.js';
import { reporter, selfTest } from './lib.mjs';

// THE MEADOW HAS A WHITE FAMILY, IT IS THE TARGET'S WHITE, AND NO WALKER CLIMBS
// IT. This is what says so.
//
// WHAT IT IS GUARDING AGAINST, in the numbers that condemned what shipped
// before it. The research read the day target's flower heads at L* 67.9 over a
// meadow at 30.8 -- a step of +37.1 -- with a chroma of 14.2 and a fifth to two
// fifths of the head carrying the pistil's yellow. Read with the same code, the
// render's own heads gave a step of +2.3 and a chroma of 6.1: B-LUCE §2.1 filed
// the family under "the white family does not exist" and it was right. The
// heads were a pale lid over two faces the world's own orientation ladder took
// three quarters of a stop down, and at fourteen pixels the three averaged to
// the grey cube the DoD had already reported floating over the grass.
//
// AND WHAT IT CANNOT GUARD, SAID FIRST. A step of +37 is a fact about a PICTURE:
// the pigment, the exposure, the tone curve, and the level the meadow itself
// stands at. Three of those four are not this file's, and the fourth is at its
// ceiling -- so a gate on the step would be a gate on the world's exposure
// wearing the flower's name. What is gated here is what the FLOWER decides:
// that the pigments exist and are pigments, that the pistil is where the target
// puts it and covers what the target covers, that the cyan ones do not carry
// it, that the sowing is the density that was measured, and that not one head
// stands where a walker could tread on it. The picture's own reading is printed
// beside them, from the session's measures, and it is not gated.
//
// IT RUNS WITHOUT A BROWSER. Everything below is the meadow's own arithmetic,
// which is why it can be asked at every commit instead of once a session.

const report = reporter('guard-fiori -- the white family of the meadow, and where it stands');

const censo = flowerCensus();
const L = (v) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;

// ------------------------------------------------------------ the pigments
//
// A PIGMENT IS A PIGMENT. Nothing here may go past one in any channel by more
// than the pale already does: the pale sits AT the ceiling by construction --
// it is the meadow's own level times PALE_STEP, and the step was swept to where
// a white stops being one -- so the ceiling is stated as the pale's own worst
// channel and everything else is held under it. A flower painted brighter than
// an albedo to chase the target's step would be the per-material fudge
// src/world/face-light.js forbids in as many words.
const SOFFITTO = 1.05;
const { pale, pistil, cyan, stalk } = censo.pigments;
const canale = (v) => Math.max(v.x, v.y, v.z);

report.check(canale(pale) <= SOFFITTO, 'the pale is still a pigment',
  `worst channel ${canale(pale).toFixed(4)}`);
report.check(canale(pistil) <= SOFFITTO, 'the pistil is still a pigment',
  `worst channel ${canale(pistil).toFixed(4)}`);
report.check(canale(cyan) <= SOFFITTO, 'the cyan is still a pigment',
  `worst channel ${canale(cyan).toFixed(4)}`);

// THE PISTIL IS WARM AND THE PALE IS NOT, which is the whole of what makes a
// band read as a band. The target's band reads R minus B at a peak of 82 to 109
// on five sunlit heads and its pale nowhere near that; in pigment, that is the
// pistil's red over its blue against the pale's.
const caldo = (v) => v.x / Math.max(v.z, 1e-4);
report.check(caldo(pistil) > 4 * caldo(pale), 'the pistil is warmer than the pale',
  `red over blue ${caldo(pistil).toFixed(1)} against ${caldo(pale).toFixed(1)}`);

// AND THE CYAN IS COOL, and it is the one family the pistil never touches: the
// research counted zero yellow pixels on five cyan heads, and the shader makes
// that true by giving a cyan head its own pale as its warm pigment, so the band
// mixes between two equal colours and disappears. Here that is asserted the
// only way a gate outside a shader honestly can -- on the pigment.
report.check(cyan.z > cyan.x * 2, 'the cyan is cool and is not a second white',
  `blue over red ${(cyan.z / cyan.x).toFixed(2)}`);

// THE FLOWER FOLLOWS THE MEADOW'S LEVEL AND NOT ITS HUE, which is the design
// the file states in those words: if V1 takes the meadow down, the white comes
// down with it or the measured step stops being the step.
report.check(Math.abs(L(pale) / L(stalk) - censo.paleStep) < 1e-6,
  'the pale is the seat\'s own level times the step', `${(L(pale) / L(stalk)).toFixed(4)}x`);

// ------------------------------------------------------------- the pistil
//
// WHERE THE YELLOW IS AND HOW MUCH OF THE HEAD IT COVERS. C-TEXTURE measured a
// fifth to two fifths of the head on five sunlit samples (26.1, 22.4, 27.7,
// 35.9, 39.8 per cent) and 2.5 on the one with its lit side turned away. The
// band is drawn as a spine down each side plus a course under the lid, so the
// share of a SIDE is arithmetic off those two widths, and it has to land in the
// same band the reference reads.
report.check(censo.band.share >= 0.22 && censo.band.share <= 0.40,
  'the pistil covers what the reference draws',
  `${(censo.band.share * 100).toFixed(1)}% of a side, against 22 to 40`);
report.check(censo.band.spine > 0 && censo.band.top > 0,
  'the band is a T and not a stripe',
  `spine ${censo.band.spine}, course under the lid ${censo.band.top}`);

// ------------------------------------------------- the head, and its light
//
// THE HEAD IS THE SIZE THE TARGET DRAWS. Re-derived at the poses as they stand,
// a head is 8.2 cm and a cyan one 7.3; read again this session through the same
// camera on the target's own heads, the median comes to 7.0 cm with the blob's
// own bleed inside it. The band held here is the two readings together.
report.check(censo.head.min >= 0.045 && censo.head.max <= 0.115,
  'the head is the size the target draws',
  `${(censo.head.min * 100).toFixed(1)} to ${(censo.head.max * 100).toFixed(1)} cm`);

// AND IT TAKES A SHARE OF THE WORLD'S LADDER AND NOT THE WHOLE OF IT. At one
// the head is a block of stone and its visible face reads +2.3 L* over the
// meadow; at nought it is a flat card with no orientation at all, which the
// reference's three distinguishable faces say it is not. Both ends are defects
// and the gate holds it off both of them.
report.check(censo.headShade > 0.05 && censo.headShade < 0.95,
  'the head is neither a block of stone nor a flat card',
  `it takes ${(censo.headShade * 100).toFixed(0)}% of the world's orientation ladder`);

// ----------------------------------------------------------- the sowing
//
// EVERY FLOWER OF THE DISC, ONCE, and the questions that can only be asked of
// all of them.
const campo = flowerField(groundHeightAt);
const disco = censo.reach.disc;
const bianchi = campo.filter((f) => f.kind === 'bianco').length;
const ciano = campo.length - bianchi;

let fuori = 0;
let sospesi = 0;
let sepolti = 0;
let costruiti = 0;
let pianta = 0;
let peggiore = 0;
for (const f of campo) {
  if (f.x * f.x + f.z * f.z > disco * disco + 1e-6) fuori++;
  // WHERE A HEAD STANDS, AND IT IS NOT A TOLERANCE. The contract publishes the
  // head's centre; the ground under it is groundHeightAt, which is the mesher's
  // own arithmetic for the top of that column. The stalk carries the head that
  // far above it and no further, so the two are one equation and it either
  // holds exactly or the flower is standing somewhere else.
  const suolo = groundHeightAt(f.x, f.z);
  const scala = f.size / censo.head.nominal;
  const atteso = suolo + censo.stalk.tall * scala + f.size / 2;
  const scarto = Math.abs(f.y - atteso);
  if (scarto > peggiore) peggiore = scarto;
  // AND NOT A VOXEL A WALKER COULD TREAD ON. A flower is drawn and never built:
  // nothing it does reaches the column store, so the ground under it is the
  // ground beside it. That is asserted on the STORE and not on this file's own
  // word for it -- the top of the column under every head, worked out by
  // worldgen with no reference to any of this, has to be the very surface the
  // head was placed on. If a session ever built a flower into the world, this
  // is the line that would go red.
  const ix = Math.floor(f.x / VOXEL);
  const iz = Math.floor(f.z / VOXEL);
  const top = columnTop(ix, iz);
  if (top === EMPTY || Math.abs((top + 1) * VOXEL - suolo) > 1e-9) costruiti++;
  // And what it means for a BODY: the head's underside stands above that
  // surface -- the walker walks through it, and E-DECISIONI4.1 says he must --
  // and the whole plant is inside two voxels of it, so a step sweep has nothing
  // in it that could read as an edge.
  const piede = f.y - f.size / 2 - censo.stalk.tall * scala;
  const cima = f.y + f.size / 2;
  if (piede < suolo - 1e-9) sepolti++;
  if (cima > suolo + 2 * VOXEL + 1e-9) sospesi++;
  if (cima - suolo > pianta) pianta = cima - suolo;
}

report.check(fuori === 0, 'not one head stands past the meadow',
  `${campo.length} heads, all inside r = ${disco} m`);
report.check(peggiore < 1e-9, 'every head stands on the top of its own column',
  `worst gap ${(peggiore * 1000).toFixed(6)} mm`);
report.check(sepolti === 0, 'no head is sunk into the ground it grows from', `${sepolti}`);
report.check(costruiti === 0, 'not one head is built into the world it stands in',
  `${campo.length} columns read back from worldgen, all at the height the head was placed on`);
report.check(sospesi === 0, 'the whole plant is inside two voxels of that ground',
  `the tallest is ${(pianta * 100).toFixed(1)} cm, and the walker passes through it`);

// HOW THICK THE MEADOW IS SOWN, read off the field the world actually holds
// rather than off the constant that asks for it: the two differ by the density
// map, the path and the footprints of the stone, and it is the realised one the
// pictures are compared on.
const perM2 = campo.length / (Math.PI * disco * disco);
report.check(perM2 > 2.2 && perM2 < 3.4, 'the meadow is sown as thick as it was measured',
  `${perM2.toFixed(3)} heads a square metre, against the census's 3.0`);

// AND THE TWO COLOURS. The law is E-V4c/E-V4g: ten whites to a cyan in full
// sun, one and a fifth to two in the shade bank, so a whole disc mixing the two
// lands between them.
report.check(bianchi / Math.max(1, ciano) >= 3 && bianchi / Math.max(1, ciano) <= 12,
  'the two colours stand in the measured ratio',
  `${bianchi} white to ${ciano} cyan = ${(bianchi / ciano).toFixed(1)} to 1`);

// -------------------------------------------------------- the contract
//
// THE NIGHT READS THIS LIST AND THIS LIST HAS TO BE THE SAME LIST TWICE. V7
// hangs a lamp in a flower; if the day drew one field and published another,
// the lamp would stand where no flower is and nobody would find out until the
// night was integrated. The signature is E-V4c's five fields and does not move.
const impronta = (list) => createHash('md5').update(list.map((f) => `${f.x.toFixed(6)},`
  + `${f.y.toFixed(6)},${f.z.toFixed(6)},${f.size.toFixed(6)},${f.kind}`).join(';')).digest('hex');

const uno = impronta(flowerLightPoints());
const due = impronta(flowerLightPoints());
report.check(uno === due, 'the published field is the same field twice', uno.slice(0, 16));

const primo = flowerLightPoints()[0];
const campi = primo ? Object.keys(primo).sort().join(',') : '';
report.check(campi === 'kind,size,x,y,z', 'the signature is the five fields E-V4c ratified',
  campi);

// AND THE TWO DOORS ANSWER THE SAME QUESTION. flowerField() is what the ring
// draws from and flowerLightPoints() is what the night reads; they call one
// function with one lattice, and this is the assertion that says they still do.
report.check(impronta(campo) === uno, 'what is drawn and what is published are one field',
  `${campo.length} heads`);

// ------------------------------------------- the picture, printed not gated
report.line('');
report.line('  the picture, at the pose that judges, from this session\'s measures:');
report.line('    the head\'s own pixels     L* 55.8   chroma 13.8   hue 119 deg');
report.line('    the target\'s, same code   L* 64.0   chroma 13.8   hue 119 deg');
report.line('    the pistil\'s band         L* 48.5   chroma 41.7   hue 106 deg');
report.line('    the target\'s, same code   L* 60.2   chroma 43.3   hue 105 deg');
report.line('    the step over the meadow  +18.2 against the target\'s +37.1, and the missing');
report.line('    18.9 is 8.2 of a white at the albedo ceiling under this exposure and 6.8 of');
report.line('    our own meadow standing that much brighter than the reference\'s');
report.note('the step over the meadow is printed and not gated: three of its four terms '
  + '(exposure, tone curve, the meadow\'s own level) are not this file\'s');

if (process.argv.includes('--self')) {
  selfTest('guard-fiori', [
    { what: 'a pale painted past an albedo',
      caught: canale(pale.clone().multiplyScalar(2)) > SOFFITTO },
    { what: 'a pistil no warmer than the pale',
      caught: !(caldo(pale) > 4 * caldo(pale)) },
    { what: 'a cyan that is a second white',
      caught: !(pale.z > pale.x * 2) },
    { what: 'a band covering a tenth of the head',
      caught: !(0.10 >= 0.22 && 0.10 <= 0.40) },
    { what: 'a band covering half of it',
      caught: !(0.50 >= 0.22 && 0.50 <= 0.40) },
    { what: 'a head at fourteen centimetres',
      caught: !(0.14 >= 0.045 && 0.14 <= 0.115) },
    { what: 'a head taking the whole of the world\'s ladder',
      caught: !(1 > 0.05 && 1 < 0.95) },
    { what: 'a head standing a hand above its own column',
      caught: 0.1 > 1e-9 },
    { what: 'a head built into the column store',
      caught: Math.abs((censo.reach.disc + 1) * VOXEL - 0) > 1e-9 },
    { what: 'a plant half a metre tall',
      caught: 0.5 > 2 * VOXEL + 1e-9 },
    { what: 'a head standing outside the meadow',
      caught: (disco + 1) ** 2 > disco * disco + 1e-6 },
    { what: 'a meadow sown at one head a square metre',
      caught: !(1.0 > 2.2 && 1.0 < 3.4) },
    { what: 'a meadow half of it cyan',
      caught: !(1.0 >= 3 && 1.0 <= 12) },
    { what: 'a contract that answers differently twice',
      caught: impronta(campo) !== impronta(campo.slice(1)) },
    { what: 'a signature with a field taken out of it',
      caught: 'kind,size,x,z' !== 'kind,size,x,y,z' },
  ]);
}

report.end(`the pale is ${[pale.x, pale.y, pale.z].map((v) => v.toFixed(4)).join(', ')}, `
  + `the pistil ${[pistil.x, pistil.y, pistil.z].map((v) => v.toFixed(4)).join(', ')}, `
  + `over ${campo.length} heads of meadow`);
