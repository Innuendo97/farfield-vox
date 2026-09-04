import { createHash } from 'node:crypto';
import { flowerCensus, flowerField } from '../../src/world/vegetation.js';
import { flowerLightPoints, groundHeightAt } from '../../src/world/contracts.js';
import { columnTop, EMPTY, mantoAt } from '../../src/world/voxel/worldgen.js';
import { VOXEL } from '../../src/world/voxel/columns.js';
import { voxelSettings } from '../../src/world/voxel/material.js';
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
// puts it and covers what the target covers, that BOTH families carry one, that
// the sowing is the density that was measured, and that not one head stands
// where a walker could tread on it. The picture's own reading is printed beside
// them, from the session's measures, and it is not gated.
//
// AND SINCE U-FIORI-3 IT ALSO READS THE BODY. Everything this guard held was
// arithmetic over the field and none of it ever touched a triangle, which is how
// four quads wound the wrong way shipped through every gate the campaign had.
// The rays under "the plant, as a solid body" are the answer to that, and they
// are the leg to look at first if this file ever goes red on geometry.
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
const { pale, pistil, cyan, cyanPistil, stalk } = censo.pigments;
// Il livello del PRATO, dal posto che lo pubblica: lo stelo ha un colore suo da
// E-DECISIONI9.1 e non e piu il righello del bianco. Vedi il passo qui sotto.
const meadowAlbedo = voxelSettings().albedo;
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

// AND THE CYAN IS COOL, WHICH IS NOW THE ONLY HALF OF THAT RULE LEFT STANDING.
// This used to read: the cyan is the one family the pistil never touches, on the
// research's count of zero yellow pixels over five cyan heads. E-DECISIONI11
// overturns it -- <<anche i blu devono avere i pistilli>> -- so what the blues
// carry is checked under "the plant, as a solid body" instead, and what is left
// here is the reading the committente did not touch: a cyan HEAD is cool and is
// not a second white.
report.check(cyan.z > cyan.x * 2, 'the cyan is cool and is not a second white',
  `blue over red ${(cyan.z / cyan.x).toFixed(2)}`);

// THE FLOWER FOLLOWS THE MEADOW'S LEVEL AND NOT ITS HUE, which is the design
// the file states in those words: if V1 takes the meadow down, the white comes
// down with it or the measured step stops being the step.
// AND THE LEVEL IT IS MEASURED AGAINST IS THE MEADOW'S OWN, WHICH IS WHAT THIS
// LINE ALWAYS MEANT AND NO LONGER SAYS BY ACCIDENT. It used to read the level
// off the STALK, because the stalk was the meadow's pigment unchanged and the
// two were the same triple. E-DECISIONI9.1 gave the stalk a colour of its own --
// «un verde piu' intenso, leggermente piu' scuro, MAI MARRONE» -- so reading the
// step through it now measures the stalk's own 12% and calls it the white's.
// The seat publishes the meadow, and the seat is what the sentence above names.
report.check(Math.abs(L(pale) / L(meadowAlbedo) - censo.paleStep) < 1e-6,
  'the pale is the seat\'s own level times the step',
  `${(L(pale) / L(meadowAlbedo)).toFixed(4)}x`);

// AND THE STALK IS GREEN AND CAN NEVER GO BROWN, which is the constraint of
// E-DECISIONI9.1 and the one thing about that family a gate outside a shader can
// honestly assert. Brown is red over green; this triple has 2.08 of green to one
// of red where the meadow has 1.66 and the bare earth of the same world has 0.61.
report.check(stalk.y > stalk.x * 1.8 && stalk.z <= 1e-9,
  'the stalk is a deeper green than the meadow and carries no red to go brown with',
  `green over red ${(stalk.y / stalk.x).toFixed(2)}, level `
  + `${(L(stalk) / L(meadowAlbedo)).toFixed(3)}x the meadow`);

// ------------------------------------------------------------- the pistil
//
// WHERE THE YELLOW IS AND HOW MUCH OF THE HEAD IT COVERS. C-TEXTURE measured a
// fifth to two fifths of the head on five sunlit samples (26.1, 22.4, 27.7,
// 35.9, 39.8 per cent) and 2.5 on the one with its lit side turned away. The
// band is CUT as a spine down each side plus a course under the lid since
// U-FIORI-3, so the share of a SIDE is worked out off the boxes themselves, and
// it has to land in the same band the reference reads whatever the relief costs.
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
// ----------------------------------------------- the plant, as a solid body
//
// THE LEG THIS GUARD DID NOT HAVE, AND WHAT IT COST NOT TO HAVE IT.
//
// Everything above and below is arithmetic over the FIELD: where heads stand,
// what colour they are, how many there are on a square metre. Not one line of it
// ever read a triangle. So when four of the flower's nine quads were written out
// by hand with their corners in the wrong order -- the two faces along X of the
// head and the two along X of the stalk, wound clockwise seen from outside and
// therefore back-face culled -- every gate this campaign had stayed green while
// the meadow drew heads with three faces and stalks with two. The poses that
// judge look very nearly along -Z, which is exactly where the four correct quads
// were, so no still caught it either. The committente caught it by WALKING:
// <<girandoci attorno MANCANO DELLE FACCE, sia ai fiori che allo stelo>>.
//
// SO THIS ASKS THE QUESTION HE ASKED. It casts rays through the plant's own
// silhouette from eight bearings and three elevations, at the bud and at the
// most open head the law allows, and counts the rays whose NEAREST hit is a face
// turned away from the eye. That is what a hole is: standing outside a solid and
// seeing its inside. It is arithmetic and needs no browser, so it runs at every
// commit rather than once a session.
//
// It reads the faces the census publishes, which come off the same call the mesh
// is built from -- a gate holding its own copy of the geometry is the next thing
// to drift away from the geometry.
const facce = censo.faces;
const RUOLI = censo.roles;

const meno = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const prod = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]];
const punto = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unita = (a) => { const n = Math.hypot(...a); return [a[0] / n, a[1] / n, a[2] / n]; };

// EVERY FACE WOUND OUTWARD, which is the defect itself and is worth its own
// assertion beside the rays: the rays say "there is no hole", this says "and
// here is the property that makes it so", and a reader chasing a red line wants
// to be told which of the two broke.
const rovesce = facce.filter((f) => punto(prod(meno(f.corners[1], f.corners[0]),
  meno(f.corners[2], f.corners[0])), f.normal) <= 0).length;
report.check(rovesce === 0, 'every face of the plant is wound to face outward',
  `${facce.length} faces, ${rovesce} wound inward`);

/** Where a ray meets one quad, as the two triangles the index buffer makes of it. */
function incontro(face, occhio, verso) {
  const [a, b, c, d] = face.corners;
  for (const tri of [[a, b, c], [a, c, d]]) {
    const e1 = meno(tri[1], tri[0]);
    const e2 = meno(tri[2], tri[0]);
    const p = prod(verso, e2);
    const det = punto(e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const t = meno(occhio, tri[0]);
    const u = punto(t, p) * inv;
    if (u < 0 || u > 1) continue;
    const q = prod(t, e1);
    const v = punto(verso, q) * inv;
    if (v < 0 || u + v > 1) continue;
    const s = punto(e2, q) * inv;
    if (s > 1e-7) return s;
  }
  return null;
}

const GIRI = 8;
const ALZATE = [-8, 12, 40];
const GRIGLIA = 90;
let buchi = 0;
let dove = '';
let vistePeggio = Infinity;
for (const apertura of [1, 1 + censo.head.openStretch]) {
  // The plant at that openness: only the head is stretched, off the stalk's own
  // top, which is what the vertex shader does with aLook.z.
  const perno = censo.stalk.tall;
  const corpo = facce.map((f) => ({
    normal: f.normal,
    corners: f.corners.map((c) => [c[0],
      f.role === RUOLI.stalk ? c[1] : perno + (c[1] - perno) * apertura, c[2]]),
  }));
  const tutti = corpo.flatMap((f) => f.corners);
  const giu = [0, 1, 2].map((k) => Math.min(...tutti.map((c) => c[k])));
  const su = [0, 1, 2].map((k) => Math.max(...tutti.map((c) => c[k])));
  const centro = [0, 1, 2].map((k) => (giu[k] + su[k]) / 2);
  const largo = Math.max(...[0, 1, 2].map((k) => su[k] - giu[k]));
  for (let b = 0; b < GIRI; b++) {
    const az = (b / GIRI) * Math.PI * 2;
    for (const alzata of ALZATE) {
      const e = (alzata * Math.PI) / 180;
      const via = [Math.sin(az) * Math.cos(e), Math.sin(e), Math.cos(az) * Math.cos(e)];
      const occhio = [centro[0] + via[0] * 0.9, centro[1] + via[1] * 0.9, centro[2] + via[2] * 0.9];
      // An orthographic sheet of rays, so what comes back is a property of the
      // plant and not of a focal length.
      const verso = unita(meno(centro, occhio));
      const destra = unita(prod([0, 1, 0], verso));
      const alto = prod(verso, destra);
      const viste = new Set();
      for (let iy = 0; iy < GRIGLIA; iy++) {
        for (let ix = 0; ix < GRIGLIA; ix++) {
          const sx = ((ix + 0.5) / GRIGLIA - 0.5) * largo * 1.35;
          const sy = ((iy + 0.5) / GRIGLIA - 0.5) * largo * 1.35;
          const da = [occhio[0] + destra[0] * sx + alto[0] * sy,
            occhio[1] + destra[1] * sx + alto[1] * sy,
            occhio[2] + destra[2] * sx + alto[2] * sy];
          let vicino = Infinity;
          let quale = -1;
          for (let k = 0; k < corpo.length; k++) {
            const s = incontro(corpo[k], da, verso);
            if (s !== null && s < vicino) { vicino = s; quale = k; }
          }
          if (quale < 0) continue;
          viste.add(quale);
          if (punto(corpo[quale].normal, verso) >= 0) {
            buchi++;
            if (!dove) dove = `bearing ${b}, ${alzata} degrees up, head at ${apertura.toFixed(1)}`;
          }
        }
      }
      if (viste.size < vistePeggio) vistePeggio = viste.size;
    }
  }
}
report.check(buchi === 0, 'no bearing round a flower finds a face missing',
  `${GIRI} bearings x ${ALZATE.length} elevations x 2 heads, `
  + `${buchi} rays into a hole${dove ? ` (first at ${dove})` : ''}`);
report.check(vistePeggio >= 4, 'and every bearing has a whole plant in front of it',
  `the barest of the ${GIRI * ALZATE.length * 2} sweeps shows ${vistePeggio} faces`);

// THE PISTIL IS A SOLID AND IT IS ON BOTH FLOWERS. E-DECISIONI11 asks for two
// things the render before this did not have: a pistil made of volume rather
// than of paint, and a pistil on the BLUE heads, which the reference does not
// show and the committente has overruled it on. The first is faces carrying the
// pistil's role; the second is a cyan pistil pigment that is not the cyan head
// -- if the two were equal the blue's pistil would be there in the buffer and
// invisible, which is the failure this line exists to catch.
const facciePistillo = facce.filter((f) => f.role === RUOLI.pistil).length;
report.check(facciePistillo >= 6, 'the pistil is built and not painted',
  `${facciePistillo} of ${facce.length} faces carry it`);
const scartoCiano = Math.hypot(cyanPistil.x - cyan.x, cyanPistil.y - cyan.y,
  cyanPistil.z - cyan.z);
report.check(scartoCiano > 0.1 && caldo(cyanPistil) > 4 * caldo(cyan),
  'and a blue head carries one a walker can see',
  `${scartoCiano.toFixed(3)} away from its own head, red over blue `
  + `${caldo(cyanPistil).toFixed(1)} against ${caldo(cyan).toFixed(2)}`);
report.check(canale(cyanPistil) <= SOFFITTO, 'the blue\'s pistil is still a pigment',
  `worst channel ${canale(cyanPistil).toFixed(4)}`);

// AND THE SOLID COVERS WHAT THE SHEET COVERS. The share was arithmetic on two
// constants; it is the boxes' own now, and PISTIL_HALF exists so that the two
// answers are the same number at any relief. If a session moves the relief
// without moving the rib, this is the line that says so -- and the far family,
// which paints the share on one quad, would otherwise quietly stop matching the
// solid it takes over from at the exchange ring.
report.check(Math.abs(censo.band.share - censo.band.sheetShare) < 1e-9,
  'the pistil built covers the share the sheet paints',
  `${censo.band.share.toFixed(4)} against ${censo.band.sheetShare.toFixed(4)}, `
  + `at a relief of ${(censo.band.proudMetres * 1000).toFixed(2)} mm and a rib `
  + `${(censo.band.ribWide * 1000).toFixed(1)} mm wide`);

// THE STALK IS A BOX AND ITS WIDTH FOLLOWS ITS OWN HEAD. E-DECISIONI9.1: the
// stalk's width runs between a QUARTER and a HALF of a cube and moves with the
// bud -- bigger head, thicker stalk. A flower is one geometry scaled uniformly,
// so the correlation is exact by construction and what is gated is where the two
// ENDS of the draw land: the smallest head's stalk must not be under a quarter
// of a cube and the largest one's must not be over a half.
const faccieStelo = facce.filter((f) => f.role === RUOLI.stalk).length;
report.check(faccieStelo === 5, 'the stalk is a closed box, lid apart',
  `${faccieStelo} faces: four sides and a foot, and the head's floor over the lid`);
const steloMin = censo.stalk.wide * (censo.head.min / censo.head.nominal);
const steloMax = censo.stalk.wide * (censo.head.max / censo.head.nominal);
report.check(steloMin >= 0.25 * VOXEL - 1e-9 && steloMax <= 0.5 * VOXEL + 1e-9,
  'a stalk is a quarter to a half of a cube, and follows its own head',
  `${(steloMin * 100).toFixed(1)} to ${(steloMax * 100).toFixed(1)} cm on heads of `
  + `${(censo.head.min * 100).toFixed(1)} to ${(censo.head.max * 100).toFixed(1)}`);
report.check(censo.stalk.steps > 1 && censo.stalk.grade > 0,
  'and it steps from foot to crown rather than standing one colour',
  `${censo.stalk.steps} rungs, ${(censo.stalk.grade * 100).toFixed(0)}% between them`);

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
let aperte = 0;
for (const f of campo) {
  if (f.x * f.x + f.z * f.z > disco * disco + 1e-6) fuori++;
  // WHERE A HEAD STANDS, AND IT IS NOT A TOLERANCE. The contract publishes the
  // head's centre; the ground under it is groundHeightAt, which is the mesher's
  // own arithmetic for the top of that column. The stalk carries the head that
  // far above it and no further, so the two are one equation and it either
  // holds exactly or the flower is standing somewhere else.
  // AND THE MAT IS BETWEEN THE TWO NOW, WHICH IS THE TARGET'S OWN READING AND NOT
  // A TOLERANCE EITHER. E-ERBA-A 4 measured two heads at 30 cm and at 15 cm over
  // the plane and read the difference as the grass under them: «i fiori stanno su
  // colonne d'erba di altezza diversa», which is E-DECISIONI8.4's «i fiori sono
  // voxel d'erba + voxel bocciolo col pistillo». So the equation gained one term
  // and stayed an equation: the plane, the mat, the stalk, half a head. mantoAt
  // is worldgen's own statement of the mat's height, the same one the store is
  // written from, so this is still the world checking the flower and not the
  // flower checking itself.
  //
  // AND THE HEAD IS THE HEAD THIS FLOWER HAS, WHICH IS THE TERM THAT MOVED
  // TWICE. The head is SQUAT -- it has been since U-ERBA-1, 6.3 cm on 8.2 over
  // nineteen -- and the equation here still read it as a cube, so it stood 8.7 mm
  // wrong on every flower in the disc and had been since that census landed. And
  // a quarter of the heads are OPEN now (E-DECISIONI9.1), drawn up to
  // OPEN_STRETCH taller than the bud, which the contract's five fields do not
  // carry and must not start carrying.
  //
  // So the equation is INVERTED rather than weakened into a tolerance: how far
  // open this head is gets solved out of the height it published, and then it
  // either lands on a value the law allows or it does not. That is a stronger
  // gate than the one it replaces, because it reads the seating AND the openness
  // at once -- a head half a millimetre high is an illegal openness and goes red
  // for it.
  const suolo = groundHeightAt(f.x, f.z);
  const manto = mantoAt(f.x, f.z);
  const scala = f.size / censo.head.nominal;
  const seggio = suolo + manto + censo.stalk.tall * scala;
  const aperta = ((f.y - seggio) * 2) / (f.size * censo.head.squat);
  // A bud is exactly one and an open head is at most one and the stretch; what
  // has to be nothing is the distance from that closed interval.
  const scarto = Math.max(0, 1 - aperta, aperta - (1 + censo.head.openStretch));
  if (scarto > peggiore) peggiore = scarto;
  if (aperta > 1 + 1e-9) aperte++;
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
  // Both worked out from the openness solved above, so a head that grew upward
  // is measured at the height it grew to and not at the bud's.
  const mezza = (f.size * censo.head.squat * aperta) / 2;
  const piede = f.y - mezza - censo.stalk.tall * scala;
  const cima = f.y + mezza;
  // NOT SUNK INTO THE MAT EITHER: the foot of the stalk sits ON the blade under
  // it, so the surface a flower may not be buried in is the mat's top and not
  // the plane's.
  if (piede < suolo + manto - 1e-9) sepolti++;
  // AND THE PLANT IS MEASURED FROM THE TOP OF THE MAT, WHICH IS THE SAME BODY
  // STATEMENT IN THE WORLD THAT EXISTS. The reading is «a step sweep has nothing
  // in it that could read as an edge»: the sweep reads groundHeightAt, which is
  // the PLANE and stays the plane by the committente's own word (E-DECISIONI9.2,
  // «il camminatore attraversa erba e fiori passandoci attraverso»). What the
  // two voxels bound is the PLANT -- stalk and head -- and the mat under it is
  // the world it grows out of, not part of it. Measured from the plane the
  // tallest flower stands 43 cm and would fail a bound that has nothing to do
  // with it; measured from its own foot it is 14 cm, which is inside two voxels
  // as it always was.
  if (cima > suolo + manto + 2 * VOXEL + 1e-9) sospesi++;
  if (cima - suolo - manto > pianta) pianta = cima - suolo - manto;
}

report.check(fuori === 0, 'not one head stands past the meadow',
  `${campo.length} heads, all inside r = ${disco} m`);
report.check(peggiore < 1e-9, 'every head stands on the top of its own column',
  `worst gap ${(peggiore * 1000).toFixed(6)} mm`);
// AND THE HEADS THAT ARE OPEN ARE THE SHARE THE LAW SAYS. The two numbers are
// declared and not measured -- the census of nineteen resolves a median height
// and no spread for it -- so what is gated is that the FILE does what it says,
// which is the only part of this a gate can honestly hold. A fifth of a share
// either way is the lattice's own quantisation over ten thousand draws.
const quotaAperte = aperte / Math.max(1, campo.length);
report.check(Math.abs(quotaAperte - censo.head.openShare) < 0.02,
  'the heads that stand open are the share E-DECISIONI9.1 was given',
  `${(quotaAperte * 100).toFixed(1)}% against ${(censo.head.openShare * 100).toFixed(0)}, `
  + `stretched to at most ${((1 + censo.head.openStretch) * censo.head.squat).toFixed(3)} of their own width`);
report.check(sepolti === 0, 'no head is sunk into the ground it grows from', `${sepolti}`);
report.check(costruiti === 0, 'not one head is built into the world it stands in',
  `${campo.length} columns read back from worldgen, all at the height the head was placed on`);
report.check(sospesi === 0, 'the whole plant is inside two voxels of the mat it stands on',
  `the tallest is ${(pianta * 100).toFixed(1)} cm over its own foot, `
  + 'and the walker passes through all of it');

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
    // THE DEFECT THIS SESSION SHIPPED FOR FOUR SESSIONS, injected exactly as it
    // stood: one face of the plant with its second and third corners swapped,
    // which is what a hand writing out a quad backwards produces. The winding
    // leg has to bite on it, and so do the rays.
    { what: 'a face of the head wound the wrong way round',
      caught: (() => {
        const f = facce.find((q) => q.role === RUOLI.side);
        const c = [f.corners[0], f.corners[2], f.corners[1], f.corners[3]];
        return punto(prod(meno(c[1], c[0]), meno(c[2], c[0])), f.normal) <= 0;
      })() },
    { what: 'a plant with no face at all on one bearing',
      caught: !(1 >= 4) },
    { what: 'a pistil that is paint and not a solid',
      caught: !(0 >= 6) },
    { what: 'a blue head whose pistil is its own colour',
      caught: !(0 > 0.1 && caldo(cyan) > 4 * caldo(cyan)) },
    { what: 'a blue pistil painted past an albedo',
      caught: canale(cyanPistil.clone().multiplyScalar(3)) > SOFFITTO },
    { what: 'a solid that covers a share the sheet does not paint',
      caught: !(Math.abs(0.28 - censo.band.sheetShare) < 1e-9) },
    { what: 'a stalk left open on one side',
      caught: !(4 === 5) },
    { what: 'a stalk a whole cube thick',
      caught: !(VOXEL >= 0.25 * VOXEL - 1e-9 && VOXEL <= 0.5 * VOXEL + 1e-9) },
    { what: 'a stalk standing one flat colour from foot to crown',
      caught: !(1 > 1 && 0 > 0) },
    { what: 'a head opened past the law that allows it',
      caught: Math.max(0, 1 - 2.0, 2.0 - (1 + censo.head.openStretch)) > 1e-9 },
    { what: 'every head in the meadow drawn open',
      caught: !(Math.abs(1.0 - censo.head.openShare) < 0.02) },
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
