import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flowerCensus, flowerField } from '../../src/world/vegetation.js';
import { flowerLightPoints, groundHeightAt } from '../../src/world/contracts.js';
import { columnTop, EMPTY, mantoAt } from '../../src/world/voxel/worldgen.js';
import { VOXEL } from '../../src/world/voxel/columns.js';
import { voxelSettings } from '../../src/world/voxel/material.js';
import { POSE_TARGET } from '../../src/core/poses.js';
import { faceColour, readLight, renderChain } from '../lighting/render-chain.mjs';
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

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

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

// ------------------------------------------------------------- the lantern
//
// WHAT THIS SECTION USED TO GATE, AND WHY IT DOES NOT ANY MORE.
//
// C-TEXTURE §1.6 measured the day target's pistil as a fifth to two fifths of a
// head's pixels -- 26.1, 22.4, 27.7, 35.9, 39.8 on five sunlit samples -- in a
// vertical band on the edge turned to the eye, and this file held the render
// inside that corridor. The committente has since seen the corridor drawn four
// different ways (E-FIORI4a) and chosen a flower that has no band at all: the
// pistil is INSIDE the bud, seen through petals that pass light
// (E-DECISIONI15). A share of the SURFACE is no longer a thing this flower has,
// so the corridor is retired by his word rather than by a measurement, and the
// gate that held it is retired with it instead of being quietly loosened.
//
// WHAT IS GATED INSTEAD IS WHAT THE NEW FLOWER PROMISES, and every number of it
// comes off the census, which is built from the same call the mesh is:
//
//   the petals pass light, but not so much that a head stops being a block;
//   the lamp burns by day, but not past the top of the bloom's own shoulder;
//   by day the lamp is INSIDE the bud, and that is read off the boxes;
//   at full bloom it comes out by the share E-DECISIONI15 gives its kind.
const LANT = censo.lantern;

// A PETAL PASSES LIGHT AND A HEAD IS STILL A BLOCK. <<Petali leggermente
// trasparenti>>: at one nothing shows through and the lamp inside is not merely
// dim, it is invisible -- measured, the head's warmest pixel does not move by a
// single level between uGlow nought and uGlow 2.6. Under a half the head stops
// being the solid white or blue the target draws. Both ends are defects.
report.check(LANT.alpha > 0.5 && LANT.alpha < 1,
  'a petal passes light, and a head is still a block',
  `alpha ${LANT.alpha.toFixed(2)}: a petal passes `
  + `${((1 - LANT.alpha) * 100).toFixed(0)}%, a shut head `
  + `${(((1 - LANT.alpha) ** 2) * 100).toFixed(1)}%`);

// AND THE LAMP BURNS BY DAY WITHOUT GOING WHITE. <<Il pistillo EMETTE LUCE anche
// di giorno, molto fioca>>, and the ceiling on "faintly" is not taste: the post
// chain takes the bloom from the scene buffer at a threshold and a knee, so a
// source over threshold + knee is taken WHOLE and its halo loses the colour that
// is the point of it. The two numbers are read out of src/core/post.js, which
// does not publish them -- so they are read as text by an expression that THROWS
// unless it matches exactly, which is DEV1's discipline: a guard that carried
// its own copy of the post chain's threshold would go stale silently, and this
// one goes red loudly.
const postText = readFileSync(join(REPO, 'src/core/post.js'), 'utf8');
const bloomOf = (name) => {
  const hit = new RegExp(`${name}: ([0-9.]+),`).exec(postText);
  if (!hit) throw new Error(`guard-fiori: src/core/post.js no longer states ${name}`);
  return Number(hit[1]);
};
const SOGLIA = bloomOf('bloomThreshold');
const GINOCCHIO = bloomOf('bloomKnee');
// The brightest lamp the meadow can draw: the white pistil's worst channel,
// times the day's glow, times the most a single flower's own multiplier reaches.
const GLOW_PER_FIORE = 1.25;
const lampadaMax = canale(pistil) * LANT.glowDay * GLOW_PER_FIORE;
report.check(LANT.glowDay > 0 && lampadaMax < SOGLIA + GINOCCHIO,
  'the day\'s lamp is lit and is inside the bloom\'s own shoulder',
  `brightest ${lampadaMax.toFixed(3)} against a shoulder of `
  + `${(SOGLIA - GINOCCHIO).toFixed(2)} to ${(SOGLIA + GINOCCHIO).toFixed(2)}`);
report.check(lampadaMax > SOGLIA - GINOCCHIO,
  'and it is over the foot of that shoulder, so there is a halo to see',
  `${lampadaMax.toFixed(3)} over ${(SOGLIA - GINOCCHIO).toFixed(2)}`);
// AND THE NIGHT IS STRONGER THAN THE DAY, which is the whole of what a night the
// day cannot draw can be asserted to be from here.
report.check(LANT.glowNight > LANT.glowDay * 3,
  'the night\'s lamp is a different order from the day\'s',
  `${LANT.glowNight} against ${LANT.glowDay}`);

// ------------------------------------------------- the head, and its light
//
// THE HEAD IS THE SIZE THE TARGET DRAWS, AND WHAT THAT SENTENCE MEANS CHANGED
// UNDER THIS GATE (U-FIORI-7).
//
// It used to hold 4.5 to 11.5 cm, which is <<the two readings of the target's
// own centimetres together>> -- 8.2 from E-ERBA-A and 7.0 from the third
// reading. Both are still right about the TARGET: probed pixel by pixel, one of
// its heads at 5.84 m spans 18 px where 10 cm spans 19.15, which is 9.4.
//
// What they were never readings of is OUR PICTURE. The same head of ours spans
// 22 px at the same distance, because this flower is a lantern and carries a
// skirt of about five pixels -- lamp, halo, bloom -- that does not shrink when
// the head does. So the band below is the size at which THIS flower draws the
// target's flower, and the note over HEAD_MIN in src/world/vegetation.js carries
// the fit. It is deliberately narrow: anything back at seven and a half is the
// meadow the committente called popcorn, and anything under three is a meadow
// with no flowers in it.
report.check(censo.head.min >= 0.030 && censo.head.max <= 0.075,
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
// by hand with their corners in the wrong order -- wound clockwise seen from
// outside and therefore back-face culled -- every gate this campaign had stayed
// green while the meadow drew heads with three faces and stalks with two. The
// committente caught it by WALKING: <<girandoci attorno MANCANO DELLE FACCE>>.
//
// AND THE DEFECT CANNOT RECUR IN THAT FORM, WHICH IS SAID FIRST BECAUSE IT
// CHANGES WHAT THESE RAYS ARE FOR. The shell of E-DECISIONI15 is panels drawn on
// BOTH sides: there is no back face to cull, so a petal wound the wrong way
// round would still be drawn. What a winding still decides is the LIGHT -- a
// panel is lit by its declared normal -- so the winding leg stays, and it is now
// a statement about brightness rather than about presence. What the rays answer
// is the other half, which no side setting can give away: is a SHUT bud closed,
// or can a walker at some bearing see into the inside of it.
//
// It reads the faces the census publishes, which come off the same call the mesh
// is built from -- a gate holding its own copy of the geometry is the next thing
// to drift away from the geometry -- and it reads them PER KIND, because the two
// flowers are two geometries since the lamps stopped being the same lamp.
const RUOLI = censo.roles;
const KINDS = ['bianco', 'ciano'];

const meno = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const prod = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]];
const punto = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unita = (a) => { const n = Math.hypot(...a); return [a[0] / n, a[1] / n, a[2] / n]; };

// EVERY FACE WOUND OUTWARD, which is the defect itself and is worth its own
// assertion beside the rays: the rays say "there is no hole", this says "and
// here is the property that makes a face bright on the side it should be", and a
// reader chasing a red line wants to be told which of the two broke. A face may
// be a triangle now -- the tips that shut over a bud are three-cornered -- so
// the test is on the first three corners, which is the winding the index buffer
// emits for either shape.
for (const kind of KINDS) {
  const facce = censo.faces[kind];
  const rovesce = facce.filter((f) => punto(prod(meno(f.corners[1], f.corners[0]),
    meno(f.corners[2], f.corners[0])), f.normal) <= 0).length;
  report.check(rovesce === 0, `every face of a ${kind} plant is wound to face outward`,
    `${facce.length} faces, ${rovesce} wound inward`);
}

/** Where a ray meets one face, quad or triangle, as the triangles it is drawn as. */
function incontro(face, occhio, verso) {
  const c = face.corners;
  const tris = c.length === 3 ? [[c[0], c[1], c[2]]]
    : [[c[0], c[1], c[2]], [c[0], c[2], c[3]]];
  for (const tri of tris) {
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

/**
 * THE PLANT AS IT IS ACTUALLY DRAWN, at an aperture and a stretch.
 *
 * The vertex shader is the producer of this motion and this is the only place
 * that reproduces it, so it reproduces it in the same order and out of the same
 * published numbers: the head stretches off the stalk's own top, then each petal
 * turns outward about the bottom edge of its own side, then the lamp rises by
 * its own share of the head past the day's ceiling. If the two ever part company
 * the rays stop describing the mesh, which is why the openness this sweeps at
 * comes off censo.lantern and never off a literal here.
 */
/**
 * HOW FAR ALONG THE BLOOM A LAMP IS AT AN APERTURE, which is the shader's own
 * law written once here so that everything below reads the same one.
 *
 *     nought at and under the day's ceiling, one at full bloom, linear between.
 *
 * The FLOOR is the whole of what makes <<di giorno i pistilli stanno DENTRO la
 * testa>> a construction instead of a hope, and it is the thing a session can
 * lose without noticing -- take the subtraction out and every flower in the
 * meadow carries its lamp a tenth of the way out in broad daylight.
 */
function avantiDi(aperture) {
  return Math.min(1, Math.max(0, (aperture - LANT.dayOpen) / (1 - LANT.dayOpen)));
}

function corpoDi(kind, aperture, stretch, reach = 0) {
  const perno = censo.stalk.tall;
  const H = censo.head.nominal;
  const sporgenza = avantiDi(aperture) * (LANT[kind].gap * stretch + reach * H);
  // THE SHELL AT THIS APERTURE COMES FROM THE ONE PRODUCER. Since E-DECISIONI16
  // nothing about the shell turns -- what the hour moves is the WIDTH of the hole
  // in the lid, and that is geometry, so a gate that rebuilt a rim here would be
  // a second opinion about where the rim is. facesAt() is flowerBoxes() and the
  // mesh is built from the same call.
  return censo.facesAt(kind, aperture).map((f) => {
    const head = f.role !== RUOLI.stalk;
    const corners = f.corners.map((c) => {
      const q = [c[0], head ? perno + (c[1] - perno) * stretch : c[1], c[2]];
      if (f.role === RUOLI.pistil) {
        const rise = f.rise ? 1 : 0;
        q[1] += sporgenza * rise;
      }
      return q;
    });
    return { corners, normal: f.normal, role: f.role, rim: f.rim };
  });
}

/**
 * THE SAME PLANT WITH ITS HOLES STOPPED UP, which is how a gate asks whether a
 * head is CLOSED now that it is meant to have an opening in it.
 *
 * E-FIORI3's leg was <<no bearing finds a way inside a shut bud>> and it was the
 * right question of a solid with no aperture. E-DECISIONI16 cut one on purpose,
 * so the question splits in two and this is the half about the SHELL: patch each
 * hole with the square of lid it is missing and every ray must meet a face
 * turned towards it. What comes back red from this is a wall left out, a lid
 * band listed the wrong way round, a throat that does not reach its own rim --
 * never the hole, which is the mandate.
 *
 * The patch is built from the RIM the boxes publish, so it is exactly the hole
 * that is there and not a square this file thinks is there.
 */
function corpoTappato(kind, aperture, stretch) {
  const corpo = corpoDi(kind, aperture, stretch);
  const q = LANT[kind].hole.shutHalf
    + (LANT[kind].hole.openHalf - LANT[kind].hole.shutHalf) * aperture;
  const perno = censo.stalk.tall;
  const lid = perno + (censo.head.nominal * censo.head.squat) * stretch;
  for (const [cx, cz] of LANT[kind].seat.xz) {
    corpo.push({
      corners: [[cx + q, lid, cz - q], [cx - q, lid, cz - q],
        [cx - q, lid, cz + q], [cx + q, lid, cz + q]],
      normal: [0, 1, 0],
      role: RUOLI.petal,
    });
  }
  return corpo;
}

// THE SHUT BUD IS SHUT FROM EVERY BEARING, which is the question the committente
// asked with his feet and the one no `side` setting can answer for the geometry.
// Rays from eight bearings and three elevations, at the bud and at the tallest
// stretch the law allows, and a hole is a ray whose NEAREST hit is a face turned
// AWAY from the eye: standing outside a solid and seeing its inside.
const GIRI = 8;
const ALZATE = [-8, 12, 40];
const GRIGLIA = 90;
const buchiDi = {};
const vistePeggioDi = {};
for (const kind of KINDS) {
  let buchi = 0;
  let dove = '';
  let vistePeggio = Infinity;
  for (const stretch of [1, 1 + censo.head.openStretch]) {
    const corpo = corpoTappato(kind, 0, stretch);
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
        const occhio = [centro[0] + via[0] * 0.9, centro[1] + via[1] * 0.9,
          centro[2] + via[2] * 0.9];
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
              if (!dove) dove = `bearing ${b}, ${alzata} degrees up, stretch ${stretch.toFixed(2)}`;
            }
          }
        }
        if (viste.size < vistePeggio) vistePeggio = viste.size;
      }
    }
  }
  buchiDi[kind] = buchi;
  vistePeggioDi[kind] = vistePeggio;
  report.check(buchi === 0, `no bearing round a ${kind} head finds a way into its shell`,
    `${GIRI} bearings x ${ALZATE.length} elevations x 2 stretches, with the lid's own `
    + `hole stopped up: ${buchi} rays into a hole${dove ? ` (first at ${dove})` : ''}`);
  report.check(vistePeggio >= 4, `and every bearing has a whole ${kind} plant in front of it`,
    `the barest of the ${GIRI * ALZATE.length * 2} sweeps shows ${vistePeggio} faces`);
}

// AND BY DAY THE LAMP IS INSIDE THE BUD. <<Di giorno... i pistilli stanno DENTRO
// la testa, coperti dai petali ma visibili in trasparenza>>. Read off the BOXES
// and not off the sentence: at the day's own ceiling on the aperture, and at
// every stretch a head may be drawn at, the lamp's bounding box has to be inside
// the shell's. The protrusion is nought there by construction -- the law divides
// by (1 - dayOpen) after subtracting dayOpen -- and this is what says the
// construction is still the one the shader runs.
// AND THE FLOOR OF THAT LAW IS EXACTLY NOUGHT, which is the assertion the
// bounding boxes below cannot make on their own: a lamp that started a tenth of
// the way out would still be inside its bud, and the picture would be right by
// luck rather than by construction. Asked at the ceiling, one step under it and
// at full bloom.
report.check(avantiDi(LANT.dayOpen) === 0 && avantiDi(LANT.dayOpen * 0.99) === 0
  && avantiDi(1) === 1,
  'the lamp does not begin to come out until the day is over',
  `nought at and under an aperture of ${LANT.dayOpen}, one at full bloom`);

const scatolaDi = (facce) => {
  const pts = facce.flatMap((f) => f.corners);
  return {
    lo: [0, 1, 2].map((k) => Math.min(...pts.map((c) => c[k]))),
    hi: [0, 1, 2].map((k) => Math.max(...pts.map((c) => c[k]))),
  };
};
for (const kind of KINDS) {
  let dentro = true;
  let margine = Infinity;
  for (const stretch of [1, 1 + censo.head.openStretch]) {
    const corpo = corpoDi(kind, LANT.dayOpen, stretch, LANT[kind].reach.max);
    const lampada = scatolaDi(corpo.filter((f) => f.role === RUOLI.pistil));
    const guscio = scatolaDi(corpo.filter((f) => f.role === RUOLI.petal
      || f.role === RUOLI.floor));
    for (let k = 0; k < 3; k++) {
      margine = Math.min(margine, lampada.lo[k] - guscio.lo[k], guscio.hi[k] - lampada.hi[k]);
      if (lampada.lo[k] < guscio.lo[k] - 1e-9 || lampada.hi[k] > guscio.hi[k] + 1e-9) {
        dentro = false;
      }
    }
  }
  report.check(dentro, `by day a ${kind} flower's lamp is inside its own bud`,
    `at an aperture of ${LANT.dayOpen} the tightest clearance is `
    + `${(margine * 1000).toFixed(2)} mm`);
}

// AND AT FULL BLOOM IT COMES OUT BY THE SHARE ITS KIND WAS GIVEN. <<I bianchi...
// di notte sporge da 1/4 a 2/4 della testa; i blu... da 1/4 a 3/4>>. Measured on
// the boxes: how far the lamp's top stands above the head's own lid at bloom
// one, over the head's width. The night is not built (E-DECISIONI2) and this is
// the whole of what can honestly be gated about it from here -- that the
// geometry the night will drive already carries the two ranges.
for (const kind of KINDS) {
  const banda = LANT[kind].reach;
  // How far the lamp's top stands over the LID THE BUD WOULD HAVE HAD, which is
  // where the shut head's own top face is: the petals have swung out of the way
  // at full bloom, so measuring against them would measure the swing and not the
  // reach.
  const lid = censo.stalk.tall + censo.head.nominal * censo.head.squat;
  const cima = (reach) => {
    const corpo = corpoDi(kind, 1, 1, reach);
    const lampada = scatolaDi(corpo.filter((f) => f.role === RUOLI.pistil));
    return (lampada.hi[1] - lid) / censo.head.nominal;
  };
  const piccola = cima(banda.min);
  const grande = cima(banda.max);
  report.check(banda.min >= 0.25 - 1e-9 && Math.abs(banda.max - (kind === 'ciano' ? 0.75 : 0.50)) < 1e-9,
    `a ${kind} flower's lamp reaches the share E-DECISIONI15 gives it`,
    `${(banda.min * 100).toFixed(0)}% to ${(banda.max * 100).toFixed(0)}% of the head`);
  report.check(Math.abs(piccola - banda.min) < 1e-9 && Math.abs(grande - banda.max) < 1e-9,
    'and at full bloom it stands exactly that far over the bud it came out of',
    `${(piccola * 100).toFixed(2)}% to ${(grande * 100).toFixed(2)}% of the head over the lid`);
}

// THE LAMP IS BUILT AND NOT PAINTED, AND IT IS ON BOTH FLOWERS. E-DECISIONI11
// asked for two things the render before it did not have: a pistil made of
// volume rather than of paint, and a pistil on the BLUE heads, which the
// reference does not show and the committente has overruled it on. The first is
// faces carrying the pistil's role; the second is a cyan pistil pigment that is
// not the cyan head -- if the two were equal the blue's lamp would be there in
// the buffer and invisible, which is the failure this line exists to catch.
for (const kind of KINDS) {
  const n = censo.faces[kind].filter((f) => f.role === RUOLI.pistil).length;
  report.check(n >= 6, `a ${kind} plant's lamp is built and not painted`,
    `${n} of ${censo.faces[kind].length} faces carry it`);
}
const scartoCiano = Math.hypot(cyanPistil.x - cyan.x, cyanPistil.y - cyan.y,
  cyanPistil.z - cyan.z);
report.check(scartoCiano > 0.1 && caldo(cyanPistil) > 4 * caldo(cyan),
  'and a blue head carries one a walker can see',
  `${scartoCiano.toFixed(3)} away from its own head, red over blue `
  + `${caldo(cyanPistil).toFixed(1)} against ${caldo(cyan).toFixed(2)}`);
report.check(canale(cyanPistil) <= SOFFITTO, 'the blue\'s pistil is still a pigment',
  `worst channel ${canale(cyanPistil).toFixed(4)}`);

// A BLUE FLOWER CARRIES FOUR STAMENS, ALWAYS. E-DECISIONI16.2: <<non voglio piu'
// quelli da 3>>. U-FIORI-4 held four in the buffer and collapsed one on seven
// flowers in ten; what has to be true now is that nothing in the geometry CAN
// collapse -- no face marked as the odd one, and four lamps in the boxes. Read
// off the faces and off the field, because the count is a fact about both.
{
  const stami = censo.faces.ciano.filter((f) => f.role === RUOLI.pistil);
  report.check(LANT.ciano.stems === 4 && LANT.ciano.seat.xz.length === 4,
    'a blue flower carries four stamens and cannot drop one',
    `${LANT.ciano.seat.xz.length} seats, ${stami.length} lamp faces`);
  report.check(censo.faces.ciano.every((f) => f.extra === undefined)
    && censo.faces.bianco.every((f) => f.extra === undefined),
    'and no face of either plant is marked as the one that may go missing',
    'the collapsible fourth of U-FIORI-4 is out of the geometry, not set to nought');
  // AND EACH OF THEM STANDS UNDER ITS OWN HOLE, which is the placement
  // E-DECISIONI16.1 asks for: <<blu = 4 fori piu' piccoli, sopra i quattro
  // stami>>. Read off the two producers -- the lamps' seats and the holes' rims
  // are the same list, so this asserts that they still are.
  const sotto = LANT.ciano.seat.xz.every(([cx, cz]) => Math.abs(cx) === Math.abs(LANT.ciano.offset)
    && Math.abs(cz) === Math.abs(LANT.ciano.offset));
  report.check(sotto, 'and each of the four stands under a hole of its own',
    `four seats at ${(LANT.ciano.offset * 100).toFixed(2)} cm from the head's own axis`);
}

// THE HOLE IN THE LID IS A HOLE, AND IT IS THE WIDTH THE HOUR ASKS FOR.
//
// This is the half of E-DECISIONI16.1 that the sealed sweep above deliberately
// does not ask: there IS an opening, it is where the mandate put it, and it
// widens with the aperture. Measured by RASTERISING the lid plane -- every panel
// of the shell that lies in it, at four hundred by four hundred -- and reading
// what is left uncovered. Not by trusting the rim: a lid whose four bands were
// mitred wrong would still publish a rim and would not have a square hole.
for (const kind of KINDS) {
  const H = censo.head.nominal;
  const lid = censo.stalk.tall + H * censo.head.squat;
  const N = 400;
  const buco = (aperture) => {
    const bande = corpoDi(kind, aperture, 1).filter((f) => f.role === RUOLI.petal
      && f.corners.every((c) => Math.abs(c[1] - lid) < 1e-9));
    let vuoti = 0;
    for (let iy = 0; iy < N; iy += 1) {
      const wz = -H / 2 + ((iy + 0.5) / N) * H;
      for (let ix = 0; ix < N; ix += 1) {
        const wx = -H / 2 + ((ix + 0.5) / N) * H;
        const dentro = bande.some((f) => {
          // A trapezoid of the mitre, tested as the triangles it is drawn as.
          const c = f.corners;
          for (let t = 0; t + 2 < c.length; t += 1) {
            const a = c[0];
            const b = c[t + 1];
            const d = c[t + 2];
            const area = (b[0] - a[0]) * (d[2] - a[2]) - (d[0] - a[0]) * (b[2] - a[2]);
            const s = ((b[0] - a[0]) * (wz - a[2]) - (wx - a[0]) * (b[2] - a[2])) / area;
            const u = ((wx - a[0]) * (d[2] - a[2]) - (d[0] - a[0]) * (wz - a[2])) / area;
            if (s >= -1e-9 && u >= -1e-9 && s + u <= 1 + 1e-9) return true;
          }
          return false;
        });
        if (!dentro) vuoti += 1;
      }
    }
    return (vuoti / (N * N)) * H * H;
  };
  const lati = LANT[kind].seat.xz.length;
  const atteso = (a) => {
    const q = LANT[kind].hole.shutHalf
      + (LANT[kind].hole.openHalf - LANT[kind].hole.shutHalf) * a;
    return lati * (2 * q) ** 2;
  };
  for (const [nome, a] of [['shut', 0], ['by day', LANT.dayOpen], ['in bloom', 1]]) {
    const letto = buco(a);
    report.check(Math.abs(letto - atteso(a)) < 1e-5 && letto > 0,
      `a ${kind} lid is pierced ${nome}, by the width its own hour asks for`,
      `${(letto * 1e4).toFixed(3)} cm2 of hole rasterised against `
      + `${(atteso(a) * 1e4).toFixed(3)} published, over ${lati} hole${lati > 1 ? 's' : ''}`);
  }
  // AND IT IS NARROW BY DAY AND WIDE AT NIGHT, which is the sentence itself.
  // Both ends are gated: a day hole under a couple of pixels at one metre is a
  // speck and not an opening, and a bloom hole narrower than the lamp under it
  // would have the lamp climbing into its own lid.
  const giorno = LANT[kind].hole.shutHalf
    + (LANT[kind].hole.openHalf - LANT[kind].hole.shutHalf) * LANT.dayOpen;
  const lampada = LANT[kind].seat.half;
  report.check(LANT[kind].hole.openHalf > giorno * 1.5 && giorno * 2 > 0.004,
    `and a ${kind} hole is narrow by day and wide at full bloom`,
    `${(giorno * 200).toFixed(2)} cm across by day against `
    + `${(LANT[kind].hole.openHalf * 200).toFixed(2)} in bloom`);
  report.check(LANT[kind].hole.openHalf > lampada,
    `and wide enough at full bloom for the lamp to come out of it`,
    `${((LANT[kind].hole.openHalf - lampada) * 1000).toFixed(2)} mm of clearance either side`);
  // AND THE LID KEEPS A RIM OUTSIDE ITS WIDEST HOLE, which is what places the
  // blue stamens (LID_RIM) and what stops a hole eating its own frame.
  const bordo = Math.min(...LANT[kind].seat.xz.map(([cx, cz]) => Math.min(
    H / 2 - Math.abs(cx) - LANT[kind].hole.openHalf,
    H / 2 - Math.abs(cz) - LANT[kind].hole.openHalf,
  )));
  report.check(bordo >= LANT.lidRim * H - 1e-9,
    `and a ${kind} lid still has a rim outside its widest hole`,
    `${(bordo * 1000).toFixed(2)} mm against the ${(LANT.lidRim * H * 1000).toFixed(2)} asked`);
}

// THE WALLS OF THE HOLE ARE BUILT, AND THEY FACE INTO IT. <<Coperchio forato con
// le pareti interne del foro disegnate>>: four panels a hole, hanging under the
// rim, each declaring a normal that points at the hole's own axis -- which is
// what makes the throat lit on the side a walker looking down at it sees. And
// they must stop short of the lamp under them, or a lamp would be drawn through
// its own chimney.
for (const kind of KINDS) {
  const H = censo.head.nominal;
  const lid = censo.stalk.tall + H * censo.head.squat;
  const gola = censo.faces[kind].filter((f) => f.role === RUOLI.petal
    && f.normal[1] === 0
    && Math.max(...f.corners.map((c) => c[1])) <= lid + 1e-9
    && Math.min(...f.corners.map((c) => c[1])) > censo.stalk.tall + 1e-9);
  const lati = LANT[kind].seat.xz.length;
  const dentro = gola.filter((f) => {
    const mid = [0, 1, 2].map((k) => f.corners.reduce((t, c) => t + c[k], 0) / f.corners.length);
    const seat = LANT[kind].seat.xz
      .map(([cx, cz]) => [cx, cz])
      .sort((a, b) => Math.hypot(mid[0] - a[0], mid[2] - a[1])
        - Math.hypot(mid[0] - b[0], mid[2] - b[1]))[0];
    // The outward normal must point BACK towards the hole's centre.
    return (seat[0] - mid[0]) * f.normal[0] + (seat[1] - mid[2]) * f.normal[2] > 0;
  }).length;
  report.check(gola.length === 4 * lati && dentro === gola.length,
    `a ${kind} hole has four walls and every one of them faces into it`,
    `${gola.length} panels over ${lati} hole${lati > 1 ? 's' : ''}, ${dentro} facing inward`);
  const fondo = Math.min(...gola.map((f) => Math.min(...f.corners.map((c) => c[1]))));
  const cima = Math.max(...censo.faces[kind].filter((f) => f.role === RUOLI.pistil)
    .flatMap((f) => f.corners.map((c) => c[1])));
  report.check(fondo > cima + 1e-9,
    `and the throat stops short of the lamp it stands over`,
    `${((fondo - cima) * 1000).toFixed(2)} mm of clearance, throat ${((lid - fondo) * 1000)
      .toFixed(2)} mm deep`);
}

// THE STEM UNDER THE NUCLEUS FADES, AND THE NUCLEUS DOES NOT.
//
// E-DECISIONI16.4: <<la fonte luminosa e' il NUCLEO del pistillo, non lo stelo
// sottile: lo stelo e' luminoso solo SOTTO il nucleo e sfuma verso il suo colore
// naturale in basso>>. The shader multiplies the emission by aPart.z, which is
// what packLook() writes, so what is gated is what packLook() writes: one over
// the whole of the nucleus, one at the top of the column and NOUGHT at its foot.
// If it were one everywhere the stem would be a lit filament; if it were nought
// on the nucleus the lamp would go out.
for (const kind of KINDS) {
  const lamp = censo.faces[kind].filter((f) => f.role === RUOLI.pistil);
  const nucleo = lamp.filter((f) => f.rise);
  const stelo = lamp.filter((f) => f.riseTop);
  const quote = (f) => {
    const mid = f.corners.reduce((a, c) => a + c[1], 0) / f.corners.length;
    return f.corners.map((c) => (f.rise ? 1 : (c[1] > mid ? 1 : 0)));
  };
  const nucleoPieno = nucleo.every((f) => quote(f).every((v) => v === 1));
  const steloAlto = stelo.every((f) => quote(f).filter((v) => v === 1).length === 2);
  const steloBasso = stelo.every((f) => quote(f).filter((v) => v === 0).length === 2);
  report.check(nucleo.length > 0 && stelo.length > 0 && nucleoPieno && steloAlto && steloBasso,
    `a ${kind} lamp burns over the whole of its nucleus and fades down its stem`,
    `${nucleo.length} nucleus faces at one, ${stelo.length} stem faces from one at the `
    + 'top to nought at the foot');
}

// AND THE HALO IS THERE, IS WARM, AND DOES NOT GO WHITE.
//
// <<Basta un alone che simuli il pistillo illuminato, che si intraveda
// attraverso i petali>> -- and E-FIORI4 shipped without one, which is the defect
// this session is answering. Three things have to be true of it and all three
// are arithmetic: it is lit at all; the brightest the shell can be driven to
// stays under the top of the post chain's bloom shoulder, so the halo keeps its
// colour instead of going white; and the mean the far family carries is a mean
// of the same term the near family evaluates, so the exchange ring has no step
// of warmth in it.
{
  report.check(LANT.halo > 0, 'the shell carries a halo and not just the lamp',
    `${LANT.halo} of the lamp's own pigment, averaged over the head's own skin`);
  // The brightest a shell fragment can be driven to by day: the warm pigment's
  // worst channel, the day's glow, the biggest flower's own multiplier, this
  // strength, and the most the radial term reaches anywhere on the skin.
  const alone = (kind) => {
    const seat = LANT[kind].seat;
    const r2 = seat.half * seat.half;
    let top = 0;
    for (const f of censo.faces[kind]) {
      if (f.role !== RUOLI.petal && f.role !== RUOLI.floor) continue;
      const c = f.corners;
      for (let iy = 0; iy <= 12; iy += 1) {
        for (let ix = 0; ix <= 12; ix += 1) {
          const u = ix / 12;
          const v = iy / 12;
          const p = [0, 1, 2].map((k) => (c[0][k] * (1 - u) + c[1][k] * u) * (1 - v)
            + (c[3][k] * (1 - u) + c[2][k] * u) * v);
          let h = 0;
          for (const [cx, cz] of seat.xz) {
            h += r2 / (r2 + (p[0] - cx) ** 2 + (p[1] - seat.y) ** 2 + (p[2] - cz) ** 2);
          }
          top = Math.max(top, h);
        }
      }
    }
    return top;
  };
  // AND THE STRENGTH IS PER KIND, DERIVED: the mean asked for, over what the
  // term averages on that kind's own skin. Read here the same way the material
  // is given it, so a session that changed one and not the other goes red.
  const forza = (kind) => LANT.halo / LANT[kind].haloMean;
  const piu = Math.max(...KINDS.map((kind) => alone(kind) * forza(kind)
    * canale(kind === 'ciano' ? cyanPistil : pistil)))
    * LANT.glowDay * GLOW_PER_FIORE;
  report.check(piu < SOGLIA + GINOCCHIO,
    'and the brightest the halo can drive a wall to is still inside the bloom\'s shoulder',
    `${piu.toFixed(3)} against a shoulder that ends at ${(SOGLIA + GINOCCHIO).toFixed(2)}`);
  for (const kind of KINDS) {
    const seat = LANT[kind].seat;
    const r2 = seat.half * seat.half;
    // SAMPLED OVER THE SKIN AND NOT AT ITS CORNERS, which is the correction this
    // leg needed: the term's own maximum sits in the MIDDLE of the cup's floor,
    // right under a lamp, and a reading taken at four corners of every panel
    // would have called the true mean an overshoot.
    const punti = [];
    for (const f of censo.faces[kind]) {
      if (f.role !== RUOLI.petal && f.role !== RUOLI.floor) continue;
      const c = f.corners;
      for (let iy = 0; iy <= 12; iy += 1) {
        for (let ix = 0; ix <= 12; ix += 1) {
          const u = ix / 12;
          const v = iy / 12;
          const p = [0, 1, 2].map((k) => (c[0][k] * (1 - u) + c[1][k] * u) * (1 - v)
            + (c[3][k] * (1 - u) + c[2][k] * u) * v);
          punti.push(seat.xz.reduce((t, [cx, cz]) => t
            + r2 / (r2 + (p[0] - cx) ** 2 + (p[1] - seat.y) ** 2 + (p[2] - cz) ** 2), 0));
        }
      }
    }
    const lo = Math.min(...punti);
    const hi = Math.max(...punti);
    report.check(LANT[kind].haloMean > lo && LANT[kind].haloMean < hi,
      `the ${kind} halo's own mean is a mean of the term the solid evaluates`,
      `${LANT[kind].haloMean.toFixed(4)} between ${lo.toFixed(4)} and ${hi.toFixed(4)} `
      + 'on the head\'s own skin');
    // AND THE TWO KINDS CARRY THE SAME LIGHT THROUGH THEIR WALLS, which is the
    // normalisation itself and the reason the far family needs no per-kind
    // number: strength times mean is the asked mean, for either flower.
    report.check(Math.abs(forza(kind) * LANT[kind].haloMean - LANT.halo) < 1e-12,
      `and a ${kind} head carries exactly the mean the far quad paints for it`,
      `strength ${forza(kind).toFixed(3)} on a mean of ${LANT[kind].haloMean.toFixed(4)} `
      + `= ${LANT.halo}`);
  }
  // AND A BLUE HEAD IS STILL A BLUE HEAD, which is the end this number was
  // actually chosen against. Not gated -- it is a reading of a FRAME, and the
  // exposure and the tone curve are two of its terms -- but the sweep is in the
  // verbale and the numbers are printed below.
  report.check(forza('ciano') < forza('bianco'),
    'and the blue head, which carries four lamps, is driven softer than the white',
    `${forza('ciano').toFixed(2)} against ${forza('bianco').toFixed(2)}`);
}

// AND THE SHARE THE FAR FAMILY PAINTS IS THE SHARE THE SOLID FILLS. Past the
// exchange ring a head is one quad, and the halo cooked into its colour is the
// lamp's own share of a shut head's silhouette. The census publishes that number
// as arithmetic; this reads it off the BOXES, by rasterising the lamp's own
// footprint against the head's, and asserts the two agree. If they ever parted,
// a head would glow one amount as a solid and another as a quad, at exactly the
// ring the far family was ratified on.
for (const kind of KINDS) {
  const N = 400;
  const H = censo.head.nominal;
  const tall = H * censo.head.squat;
  const y0 = censo.stalk.tall;
  const lampada = censo.faces[kind].filter((f) => f.role === RUOLI.pistil);
  let coperti = 0;
  for (let iy = 0; iy < N; iy++) {
    const wy = y0 + ((iy + 0.5) / N) * tall;
    for (let ix = 0; ix < N; ix++) {
      const wx = -H / 2 + ((ix + 0.5) / N) * H;
      const dentro = lampada.some((f) => {
        const xs = f.corners.map((c) => c[0]);
        const ys = f.corners.map((c) => c[1]);
        return wx >= Math.min(...xs) && wx <= Math.max(...xs)
          && wy >= Math.min(...ys) && wy <= Math.max(...ys);
      });
      if (dentro) coperti++;
    }
  }
  const letta = coperti / (N * N);
  report.check(Math.abs(letta - LANT[kind].share) < 0.005,
    `a ${kind} head's quad paints the share its own lamp fills`,
    `${(letta * 100).toFixed(2)}% rasterised against ${(LANT[kind].share * 100).toFixed(2)}% published`);
}

// THE HEAD IS A CLOSED BOX WITH A PIERCED LID, AND THE STALK IS A CLOSED BOX.
// Four sides that stand where the target's cube stands, a floor, and a lid that
// is four mitred bands per hole plus that hole's four walls; and under them four
// stalk faces and a foot, because U-FIORI-3's ray bench found 198 rays entering
// an open bottom from eight degrees below the plant and the rule it left behind
// is that a face comes off only when another face covers it.
for (const kind of KINDS) {
  const H = censo.head.nominal;
  const y0 = censo.stalk.tall;
  const y1 = y0 + H * censo.head.squat;
  const petali = censo.faces[kind].filter((f) => f.role === RUOLI.petal);
  const lati = petali.filter((f) => f.normal[1] === 0
    && Math.abs(Math.min(...f.corners.map((c) => c[1])) - y0) < 1e-9).length;
  const coperchio = petali.filter((f) => f.normal[1] > 0.5).length;
  const gola = petali.filter((f) => f.normal[1] === 0
    && Math.min(...f.corners.map((c) => c[1])) > y0 + 1e-9
    && Math.max(...f.corners.map((c) => c[1])) <= y1 + 1e-9).length;
  const fori = LANT[kind].seat.xz.length;
  report.check(lati === 4 && coperchio === 4 * fori && gola === 4 * fori,
    `a ${kind} head is four sides and a lid with ${fori} hole${fori > 1 ? 's' : ''} in it`,
    `${lati} sides, ${coperchio} bands of lid, ${gola} walls of throat`);
  report.check(petali.every((f) => f.corners.length === 4),
    'and every panel of it is a quad, so no triangle of it can be degenerate',
    `${petali.length} shell panels, all four-cornered`);
  report.check(censo.faces[kind].filter((f) => f.role === RUOLI.floor).length === 1,
    'and it stands on one floor', 'the bottom of the cup');
  const stelo = censo.faces[kind].filter((f) => f.role === RUOLI.stalk).length;
  report.check(stelo === 5, `the ${kind} stalk is a closed box, lid apart`,
    `${stelo} faces: four sides and a foot, and the cup's floor over the lid`);
}

// AND THE STALK'S WIDTH FOLLOWS ITS OWN HEAD, IN THE BAND THE COMMITTENTE MOVED
// IT TO. E-DECISIONI9.1 asked for a width correlated with the bud; E-DECISIONI15
// asked for the band to narrow, and the coordinator fixed it at a FIFTH to THREE
// TENTHS of a cube. A flower is one geometry scaled uniformly, so the
// correlation is exact by construction and what is gated is where the two ENDS
// of the draw land -- and BOTH draws, because a cyan head is a tenth smaller and
// carries the narrowest stalk in the meadow.
//
// AND WITH THE HEAD IT MOVED, WHICH IS THE COORDINATOR'S OWN INSTRUCTION AND IS
// WHY THIS GATE IS NOW A RATIO. E-DECISIONI15.1 fixed the band as a fifth to
// three tenths OF A CUBE and the cube is the voxel: 2.0 to 3.0 cm, absolute.
// U-FIORI-7's mandate says <<stelo in proporzione: E-DECISIONI15 stelo 1/5-3/10
// del cubo -> RISCALATO CON LA TESTA>>, so the head at 5.2 cm carries a stalk at
// 1.7 and the absolute band the coordinator wrote in September has gone down
// with it. What is left of that decision, and what is held here, is the SHAPE:
// a stalk is a third of its own head, exactly, at both ends of the draw --
// which is the 2.5 on 7.5 he ratified, written as the ratio it always was.
const steloDi = (size) => censo.stalk.wide * (size / censo.head.nominal);
const steloMin = steloDi(censo.head.min * censo.head.cyanScale);
const steloMax = steloDi(censo.head.max);
const terzo = (size) => Math.abs(steloDi(size) - size / 3) < 1e-9;
report.check(terzo(censo.head.min * censo.head.cyanScale) && terzo(censo.head.max)
  && terzo(censo.head.nominal),
  'a stalk is a third of its own head, at both ends of the draw',
  `${(steloMin * 100).toFixed(2)} to ${(steloMax * 100).toFixed(2)} cm on heads of `
  + `${(censo.head.min * censo.head.cyanScale * 100).toFixed(1)} to `
  + `${(censo.head.max * 100).toFixed(1)}`);
report.check(Math.abs(steloDi(censo.head.nominal) - censo.head.nominal / 3) < 1e-9
  && steloMin >= 0.10 * VOXEL && steloMax <= 0.30 * VOXEL + 1e-9,
  'and the nominal one is a quarter of its own head, inside the cube it is cut from',
  `${(steloDi(censo.head.nominal) * 100).toFixed(2)} cm on a head of `
  + `${(censo.head.nominal * 100).toFixed(1)}, `
  + `${(steloMin / VOXEL).toFixed(3)} to ${(steloMax / VOXEL).toFixed(3)} of a voxel `
  + '(E-DECISIONI15 wrote 0.20 to 0.30 at the old head)');
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

// =====================================================================
// THE TARGET'S OWN MEADOW, BY DISTANCE BAND (U-FIORI-7)
// =====================================================================
//
// WHAT THIS SECTION IS FOR AND WHY IT COULD NOT BE WRITTEN BEFORE. Every gate
// above is about ONE flower -- its pigments, its body, where it stands. What the
// committente walked away from was not one flower: it was a MEADOW, of the wrong
// size, in the wrong arrangement, with none of its blue in it. Those are
// statistics of the whole field at a distance, and they are exactly the four
// numbers R1 1.5 measured on the target.
//
// AND IT RUNS WITHOUT A BROWSER, which is what makes it a gate rather than a
// session reading. The RULER is the campaign's own -- the fitted camera of R1's
// 0, focal 1158.7 px on the 1672x941 frame, the pose src/core/poses.js
// publishes -- so a head of s metres at d metres subtends s * 1158.7 / d pixels,
// and no screenshot is needed to ask how big it is.
const EYE = POSE_TARGET.position;
/** px per metre at one metre: R1's ruler, and the frame it was read on. */
const FOCALE = 1158.7;
/**
 * The silhouette of a cube seen along a unit vector is s*s*(|x|+|y|+|z|), and
 * the far family draws exactly that as a quad (see FAR_VERTEX). At a walker's
 * eye the y term is small, so the sum is about the root of two: past the
 * exchange ring a head covers this much more than its own edge.
 */
const QUAD = Math.sqrt(1.41);

const BANDE = [[4.5, 7], [7, 10], [10, 15], [15, 25]];
const mediana = (a) => (a.length ? a.slice().sort((p, q) => p - q)[Math.floor(a.length / 2)] : NaN);
const lontano = (f) => Math.hypot(f.x - EYE.x, f.z - EYE.z);

/**
 * THE TABLE THIS DELIVERY DRAWS, AND WHERE IT COMES FROM.
 *
 * These are the widths in pixels the GEOMETRY subtends per band at the fitted
 * pose. They are locked rather than derived from the target for one reason that
 * is stated plainly: what the target's finder measures on the frame is the
 * geometry PLUS this flower's skirt -- lamp, halo, bloom -- and the skirt is
 * neither this gate's to predict nor this unit's to move. Measured on the two
 * frames this session, the same window, the same instrument:
 *
 *   band        target frame   ours before   ours after   geometry after
 *   6.1 m         13 px          18 px         14 px        10.2 px
 *   13.1 m         4 px           9 px          6 px         5.4 px
 *   20.7 m         5 px           6 px          4 px         3.4 px
 *
 * The near and far bands land on the target; the middle one is 60 per cent over,
 * and the reason is written in the verbale rather than hidden here: at thirteen
 * metres the target's own 9 cm head reads 4 px because only its lit face clears
 * the finder's threshold, and ours is a quad of one flat colour that clears it
 * whole. That is the far family's stand-in, not its size, and it is a residue.
 */
const TAGLIA_PX = { '4.5-7': 10.17, '7-10': 7.88, '10-15': 5.37, '15-25': 3.41 };
const TAGLIA_TOLL = 0.10;
/**
 * And how thick, per band. It is the SOWING that is gated -- the density map,
 * the path and the stone are what make a band differ from FLOWER_PER_M2 -- so
 * the band is a fifth either way of the constant, which catches a band gone
 * empty or a band twice sown without gating the shape of the disc.
 */
const DENSITA_TOLL = 0.15;

for (const [lo, hi] of BANDE) {
  const nome = `${lo}-${hi}`;
  const sel = campo.filter((f) => { const d = lontano(f); return d >= lo && d < hi; });
  const px = sel.map((f) => {
    const d = lontano(f);
    return f.size * (d > censo.reach.ring ? QUAD : 1) * FOCALE / d;
  });
  const larghezza = mediana(px);
  const atteso = TAGLIA_PX[nome];
  report.check(Math.abs(larghezza / atteso - 1) <= TAGLIA_TOLL,
    `at ${nome} m a head is the width this delivery draws`,
    `${larghezza.toFixed(2)} px against ${atteso.toFixed(2)}, `
    + `${((larghezza / atteso - 1) * 100).toFixed(1)}%`);
  // THE AREA IS THE RING'S OWN AND NOT A RING'S, because the outer band runs off
  // the meadow: an annulus of twenty-five metres round an eye standing at z =
  // 14.2 reaches thirty-nine metres from the centre of a disc that ends at
  // thirty-five, and dividing by the whole annulus reported a sixth of the band
  // missing when what was missing was ground. Sampled rather than integrated --
  // the intersection of two circles has a closed form and this has a path and
  // five footprints of masonry in it as well, so a count on a fixed grid is both
  // shorter and the same arithmetic the sowing itself is asked with.
  let dentro = 0;
  let tutti = 0;
  const passo = 0.25;
  for (let d = lo; d < hi; d += passo) {
    for (let a = 0; a < 360; a += 2) {
      const x = EYE.x + d * Math.cos(a * Math.PI / 180);
      const z = EYE.z + d * Math.sin(a * Math.PI / 180);
      const peso = d;
      tutti += peso;
      if (x * x + z * z <= censo.reach.disc * censo.reach.disc) dentro += peso;
    }
  }
  const area = Math.PI * (hi * hi - lo * lo) * (dentro / tutti);
  const perBanda = sel.length / area;
  report.check(Math.abs(perBanda / censo.sowing.perSquareMetre - 1) <= DENSITA_TOLL,
    `and there are as many of them at ${nome} m as anywhere else`,
    `${perBanda.toFixed(3)} a square metre against the census's `
    + `${censo.sowing.perSquareMetre.toFixed(1)}`);
}

// THE GROUPS, ON THE PLANE AND NOT ON THE PICTURE.
//
// Clark-Evans is the mean nearest neighbour over what a scatter of the same
// density would give: one is a scatter, under one is clumped, over one is a
// lattice. R1 1.5 reads 0.64 on the target and 0.97 on the meadow that shipped.
//
// WHAT IS ASKED HERE IS THE PLANE'S OWN, AND THE DIFFERENCE MATTERS. R1 measures
// it in PIXELS, on components a finder found, and a big head breaks into two or
// three of them -- so half of what that instrument calls a near neighbour is the
// same flower twice. The plane cannot do that: a head is one point, the metric
// is the one the textbook defines, and the edge is corrected the way Donnelly
// corrects it (a ring of radius twelve metres round the fitted eye loses
// neighbours off its rim, and without the correction that alone reads 1.05 as
// 1.12). The two agree on this meadow to a hundredth -- 0.636 on the plane
// against R1's 0.64 on the target's frame -- and it is the plane that is gated.
const VICINO = 12;
const vicini = campo.filter((f) => lontano(f) <= VICINO);
function clarkEvans(punti, raggio) {
  let somma = 0;
  for (let i = 0; i < punti.length; i++) {
    let best = Infinity;
    for (let j = 0; j < punti.length; j++) {
      if (i === j) continue;
      const dx = punti[i].x - punti[j].x;
      const dz = punti[i].z - punti[j].z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
    }
    somma += Math.sqrt(best);
  }
  const n = punti.length;
  const densita = n / (Math.PI * raggio * raggio);
  const perimetro = 2 * Math.PI * raggio;
  const atteso = 0.5 / Math.sqrt(densita) + (0.0514 + 0.041 / Math.sqrt(n)) * perimetro / n;
  return { R: (somma / n) / atteso, vicino: somma / n, atteso };
}
const gruppi = clarkEvans(vicini, VICINO);
report.check(gruppi.R >= 0.55 && gruppi.R <= 0.75,
  'the meadow is sown in groups, at the target\'s own Clark-Evans',
  `R = ${gruppi.R.toFixed(3)} over ${vicini.length} heads inside ${VICINO} m `
  + `(nearest ${(gruppi.vicino * 100).toFixed(1)} cm against a scatter's `
  + `${(gruppi.atteso * 100).toFixed(1)}); the target reads 0.64`);

// AND ONE HEAD IN SIX IS BLUE, WHEREVER THE WALKER IS STANDING.
//
// Two things are gated and they are not the same thing. The SHARE is R1's 15 per
// cent and the coordinator's twelve-to-eighteen; measured on the frame with a
// finder that does not ask for brightness, the target reads 0.16 in its lit
// middle window and 0.25 in its near one. The REACH is the other half, and it is
// the half that made the delivered picture read one per cent blue against the
// target's fifteen: the blues were trimmed at eight metres, which is where the
// census stopped resolving them and not where the meadow stops being blue.
const quotaBlu = ciano / Math.max(1, campo.length);
report.check(quotaBlu >= 0.12 && quotaBlu <= 0.18,
  'one head in six is blue',
  `${(quotaBlu * 100).toFixed(1)}% of ${campo.length}, against the target's 15`);
report.check(censo.cyan.reach >= censo.reach.far,
  'and a blue head carries as far as a white one',
  `blues to ${censo.cyan.reach} m, whites to ${censo.reach.far}`);

// THE WHITE HEAD'S OWN LEVEL, THROUGH THE DELIVERED CHAIN.
//
// The target's white head, probed face by face at 5.84 m on the fitted frame:
// its LID reads L* 67.6 with a croma of 12.9 and its side L* 50.7 / 13.0. The
// lid is the face to hold, because it is the one face of a head whose normal is
// the same in both pictures whatever the sun is doing -- <<la testa bianca del
// bersaglio e' bianca e brillante>> (E-FIORI5, and E-LUCE4's note of method: the
// veil is off both frames).
//
// It is asked of tools/lighting/render-chain.mjs -- the seat, AgX and the
// delivered grade cube, the road guard-prato and guard-scala take -- so it can
// be asked at every commit. What is NOT in that chain is this flower's own
// halo, its petal alpha and the bloom that follows them: the chain answers for
// the PIGMENT under the light, which is the half this file owns.
const luce = readLight();
const composite = await renderChain();
const lab = (rgb) => {
  const lin = rgb.map((v) => { const u = v / 255; return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; });
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = (0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047;
  const Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  const Z = (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883;
  return { L: 116 * f(Y) - 16, C: Math.hypot(500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))) };
};
const BERSAGLIO_LID = { L: 67.6, C: 12.9 };
const lid = lab(composite(faceColour([0, 1, 0], luce, [pale.x, pale.y, pale.z])));
report.check(Math.abs(lid.L - BERSAGLIO_LID.L) <= 5,
  'the white head\'s lid is the level the target\'s white head is',
  `L* ${lid.L.toFixed(1)} against ${BERSAGLIO_LID.L}, croma ${lid.C.toFixed(1)} `
  + `against ${BERSAGLIO_LID.C}`);

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
report.line('  the picture, at one metre and at four, from this session own sweep');
report.line('  (fondazione/fiori5/sweep.mjs, the delivered frame at 1672x941, tier alto,');
report.line('  the halo swept as the MEAN it adds over the head skin, at the day glow):');
report.line('    a white head at 1 m       halo 0    R 145.0  G 150.1  B 123.0   R-B 33');
report.line('                              halo 0.22 R 159.1  G 158.2  B 125.9   R-B 44   <- delivered');
report.line('                              halo 0.50 R 172.1  G 166.6  B 130.0   R-B 52');
report.line('    a blue head at 1 m        halo 0    R 106.7  G 133.3  B 146.9   B-R 40');
report.line('                              halo 0.22 R 125.3  G 141.2  B 146.5   B-R 21   <- delivered');
report.line('                              halo 0.50 R 141.5  G 149.3  B 146.9   B-R  5');
report.line('      -- the top of that sweep is where a BLUE head stops being blue, which is');
report.line('         the end the number was chosen against, and the reason it is normalised');
report.line('    a white head at 4 m       level 1.635x the meadow (1.554 with the halo out)');
report.line('    the alpha, at that halo   R-B 44 at 0.88 against 49 at 0.80, and a head');
report.line('                              passes 1.4 per cent instead of 4.0');
report.line('    the brightest pixel       171 of 255 on a white, 164 on a blue');
report.line('    pixels over 235           none, on either flower, at any glow up to 2.6');
report.note('these are readings of a FRAME and are printed rather than gated: the exposure, '
  + 'the tone curve and the meadow\'s own level are three of their four terms and none of '
  + 'the three is this file\'s');

if (process.argv.includes('--self')) {
  // A HOLE, INJECTED THE WAY A HOLE HAPPENS: one panel of the shell taken out,
  // which is a petal a session forgot to emit. Swept from one bearing rather
  // than forty-eight, because what is being proved is that the instrument bites
  // and not how far it reaches.
  const bucato = (() => {
    const corpo = corpoTappato('bianco', 0, 1).filter((f, i) => i !== corpoTappato('bianco', 0, 1)
      .findIndex((q) => q.role === RUOLI.petal && q.normal[1] === 0));
    const tutti = corpo.flatMap((f) => f.corners);
    const giu = [0, 1, 2].map((k) => Math.min(...tutti.map((c) => c[k])));
    const su = [0, 1, 2].map((k) => Math.max(...tutti.map((c) => c[k])));
    const centro = [0, 1, 2].map((k) => (giu[k] + su[k]) / 2);
    const largo = Math.max(...[0, 1, 2].map((k) => su[k] - giu[k]));
    let buchi = 0;
    for (let b = 0; b < GIRI; b++) {
      const az = (b / GIRI) * Math.PI * 2;
      const via = [Math.sin(az), 0.2, Math.cos(az)];
      const occhio = [centro[0] + via[0] * 0.9, centro[1] + via[1] * 0.9,
        centro[2] + via[2] * 0.9];
      const verso = unita(meno(centro, occhio));
      const destra = unita(prod([0, 1, 0], verso));
      const alto = prod(verso, destra);
      for (let iy = 0; iy < 40; iy++) {
        for (let ix = 0; ix < 40; ix++) {
          const sx = ((ix + 0.5) / 40 - 0.5) * largo;
          const sy = ((iy + 0.5) / 40 - 0.5) * largo;
          const da = [occhio[0] + destra[0] * sx + alto[0] * sy,
            occhio[1] + destra[1] * sx + alto[1] * sy,
            occhio[2] + destra[2] * sx + alto[2] * sy];
          let vicino = Infinity;
          let quale = -1;
          for (let k = 0; k < corpo.length; k++) {
            const s = incontro(corpo[k], da, verso);
            if (s !== null && s < vicino) { vicino = s; quale = k; }
          }
          if (quale >= 0 && punto(corpo[quale].normal, verso) >= 0) buchi++;
        }
      }
    }
    return buchi;
  })();

  // THE LAW WITH ITS FLOOR TAKEN OUT, which is the one-character loss that would
  // put every lamp in the meadow a tenth of the way out of its bud at noon.
  const senzaSoglia = (a) => Math.min(1, Math.max(0, a / (1 - LANT.dayOpen)));

  // A LID WITH NO HOLE IN IT, rasterised by the same instrument the real one is:
  // the four bands of the mitre closed onto the hole's own centre, which is what
  // a session that let the rim collapse would ship. What comes back has to be
  // NOUGHT square centimetres of opening, which is what the leg gates against.
  const tappato = (() => {
    const H = censo.head.nominal;
    const lid = censo.stalk.tall + H * censo.head.squat;
    const bande = corpoDi('bianco', 0, 1).filter((f) => f.role === RUOLI.petal
      && f.corners.every((c) => Math.abs(c[1] - lid) < 1e-9))
      // the hole shut to nothing: every inner corner pulled to the centre
      .map((f) => ({ ...f, corners: f.corners.map((c, i) => (f.rim && (f.rim[i][0] || f.rim[i][1])
        ? [0, c[1], 0] : c)) }));
    const N = 200;
    let vuoti = 0;
    for (let iy = 0; iy < N; iy += 1) {
      const wz = -H / 2 + ((iy + 0.5) / N) * H;
      for (let ix = 0; ix < N; ix += 1) {
        const wx = -H / 2 + ((ix + 0.5) / N) * H;
        const dentro = bande.some((f) => {
          const c = f.corners;
          for (let t = 0; t + 2 < c.length; t += 1) {
            const a = c[0];
            const b = c[t + 1];
            const d = c[t + 2];
            const area = (b[0] - a[0]) * (d[2] - a[2]) - (d[0] - a[0]) * (b[2] - a[2]);
            if (Math.abs(area) < 1e-15) continue;
            const s = ((b[0] - a[0]) * (wz - a[2]) - (wx - a[0]) * (b[2] - a[2])) / area;
            const u = ((wx - a[0]) * (d[2] - a[2]) - (d[0] - a[0]) * (wz - a[2])) / area;
            if (s >= -1e-9 && u >= -1e-9 && s + u <= 1 + 1e-9) return true;
          }
          return false;
        });
        if (!dentro) vuoti += 1;
      }
    }
    return (vuoti / (N * N)) * H * H;
  })();

  // A THROAT TURNED INSIDE OUT: the four walls of a hole with their normals
  // pointing AWAY from the hole's axis, which is what a hand listing the corners
  // the other way round produces and what would light the walls on the side
  // nobody can see.
  const golaFuori = (() => {
    const H = censo.head.nominal;
    const y0 = censo.stalk.tall;
    const y1 = y0 + H * censo.head.squat;
    const gola = censo.faces.bianco.filter((f) => f.role === RUOLI.petal
      && f.normal[1] === 0
      && Math.min(...f.corners.map((c) => c[1])) > y0 + 1e-9
      && Math.max(...f.corners.map((c) => c[1])) <= y1 + 1e-9);
    const dentro = gola.filter((f) => {
      const mid = [0, 1, 2].map((k) => f.corners.reduce((t, c) => t + c[k], 0)
        / f.corners.length);
      const n = [-f.normal[0], -f.normal[1], -f.normal[2]];
      return (0 - mid[0]) * n[0] + (0 - mid[2]) * n[2] > 0;
    }).length;
    // The leg asks that EVERY wall faces into its hole; turned inside out, none
    // of them does, so what is handed back is the shortfall.
    return gola.length - dentro;
  })();

  // THE STEM LIT ALL THE WAY DOWN, which is exactly what E-DECISIONI16.4 says it
  // must not be: aPart.z left at one on the column's foot as well as its top.
  const steloAcceso = censo.faces.bianco.filter((f) => f.role === RUOLI.pistil && f.riseTop)
    .every((f) => f.corners.map(() => 1).filter((v) => v === 0).length === 2);

  selfTest('guard-fiori', [
    { what: 'a pale painted past an albedo',
      caught: canale(pale.clone().multiplyScalar(2)) > SOFFITTO },
    { what: 'a pistil no warmer than the pale',
      caught: !(caldo(pale) > 4 * caldo(pale)) },
    { what: 'a cyan that is a second white',
      caught: !(pale.z > pale.x * 2) },
    { what: 'a petal that passes nothing, and hides the lamp it was built round',
      caught: !(1.0 > 0.5 && 1.0 < 1) },
    { what: 'a petal you can see the meadow through',
      caught: !(0.30 > 0.5 && 0.30 < 1) },
    { what: 'a day lamp burning over the top of the bloom\'s shoulder',
      caught: !(canale(pistil) * 2.0 * GLOW_PER_FIORE < SOGLIA + GINOCCHIO) },
    { what: 'a day lamp that is not lit at all',
      caught: !(canale(pistil) * 0 * GLOW_PER_FIORE > SOGLIA - GINOCCHIO) },
    { what: 'a night no brighter than the day',
      caught: !(LANT.glowDay > LANT.glowDay * 3) },
    // THE DEFECT THIS FLOWER SHIPPED FOR FOUR SESSIONS, injected exactly as it
    // stood: one face with its second and third corners swapped, which is what a
    // hand writing out a quad backwards produces.
    { what: 'a face of the bud wound the wrong way round',
      caught: (() => {
        const f = censo.faces.bianco.find((q) => q.role === RUOLI.petal
          && q.corners.length === 4);
        const c = [f.corners[0], f.corners[2], f.corners[1], f.corners[3]];
        return punto(prod(meno(c[1], c[0]), meno(c[2], c[0])), f.normal) <= 0;
      })() },
    { what: 'a head with one of its walls missing', caught: bucato > 0 },
    { what: 'a plant with no face at all on one bearing',
      caught: !(1 >= 4) },
    { what: 'a lamp that is paint and not a solid',
      caught: !(0 >= 6) },
    { what: 'a blue head whose lamp is its own colour',
      caught: !(0 > 0.1 && caldo(cyan) > 4 * caldo(cyan)) },
    { what: 'a blue lamp painted past an albedo',
      caught: canale(cyanPistil.clone().multiplyScalar(3)) > SOFFITTO },
    { what: 'a lamp that starts coming out before the day is over',
      caught: !(senzaSoglia(LANT.dayOpen) === 0 && senzaSoglia(LANT.dayOpen * 0.99) === 0
        && senzaSoglia(1) === 1) },
    { what: 'a lamp that never comes out, at any hour',
      caught: !(Math.abs(0 - LANT.bianco.reach.min) < 1e-9) },
    // E-DECISIONI16.2, injected from both sides: a blue flower back down to
    // three, and a face left marked as the one that may go missing.
    { what: 'a blue flower sown with three stamens',
      caught: !(3 === 4 && 3 === 4) },
    { what: 'a face still marked as the collapsible fourth',
      caught: !([{ extra: 1 }].every((f) => f.extra === undefined)) },
    { what: 'a stamen that does not stand under a hole of its own',
      caught: !([[0.01, 0.02]].every(([cx, cz]) => Math.abs(cx) === LANT.ciano.offset
        && Math.abs(cz) === LANT.ciano.offset)) },
    // E-DECISIONI16.1: the hole, from every side it could be got wrong.
    { what: 'a lid with the hole closed up again', caught: !(tappato > 0) },
    { what: 'a hole that never widens, so nothing ever comes out of it',
      caught: !(LANT.bianco.hole.shutHalf > LANT.bianco.hole.shutHalf * 1.5) },
    { what: 'a day hole too narrow to read as an opening',
      caught: !(0.0015 * 2 > 0.004) },
    { what: 'a bloom hole narrower than the lamp under it',
      caught: !(LANT.ciano.seat.half * 0.9 > LANT.ciano.seat.half) },
    { what: 'a hole that has eaten the rim of its own lid',
      caught: !(0 >= LANT.lidRim * censo.head.nominal - 1e-9) },
    { what: 'the walls of a hole turned inside out', caught: golaFuori > 0 },
    { what: 'a throat driven down into the lamp it stands over',
      caught: !(censo.stalk.tall > censo.stalk.tall + 1e-9) },
    // E-DECISIONI16.4: the nucleus burns and the stem fades.
    { what: 'a stem lit all the way down to its foot', caught: !steloAcceso },
    { what: 'a nucleus that does not burn at all',
      caught: !([0, 0, 0, 0].every((v) => v === 1)) },
    // E-DECISIONI15 and the coordinator's eye on E-FIORI4: the halo.
    { what: 'a shell with no halo, which is the glass box of E-FIORI4',
      caught: !(0 > 0) },
    { what: 'a halo driven past the top of the bloom\'s shoulder',
      caught: !(canale(pistil) * LANT.glowDay * GLOW_PER_FIORE * 40 < SOGLIA + GINOCCHIO) },
    { what: 'a mean the solid never draws anywhere on its own skin',
      caught: !(2.0 > 0.0356 && 2.0 < 0.2809) },
    { what: 'a strength left unnormalised, so a blue head goes white',
      caught: !(Math.abs(1 * LANT.ciano.haloMean - LANT.halo) < 1e-12) },
    { what: 'a blue head driven as hard as a white one',
      caught: !(LANT.halo / LANT.ciano.haloMean < LANT.halo / LANT.ciano.haloMean) },
    { what: 'a quad painting a share the solid does not fill',
      caught: !(Math.abs(0.28 - LANT.bianco.share) < 0.005) },
    { what: 'a stalk left open on one side',
      caught: !(4 === 5) },
    { what: 'a head that is not four sides and a pierced lid',
      caught: !(3 === 4 && 4 === 4 && 4 === 4) },
    { what: 'a shell panel emitted as a triangle, which cannot be a lid band',
      caught: !([{ corners: [0, 1, 2] }].every((f) => f.corners.length === 4)) },
    { what: 'a stalk that stopped following its own head, at a literal 2.5 cm',
      caught: !(Math.abs(0.025 - censo.head.nominal / 3) < 1e-9) },
    { what: 'a stalk half its own head thick, which is the band E-DECISIONI15 narrowed',
      caught: !(Math.abs(censo.head.nominal / 2 - censo.head.nominal / 3) < 1e-9) },
    { what: 'a stalk a whole cube thick',
      caught: !(VOXEL >= 0.10 * VOXEL && VOXEL <= 0.30 * VOXEL + 1e-9) },
    { what: 'a stalk standing one flat colour from foot to crown',
      caught: !(1 > 1 && 0 > 0) },
    { what: 'a head opened past the law that allows it',
      caught: Math.max(0, 1 - 2.0, 2.0 - (1 + censo.head.openStretch)) > 1e-9 },
    { what: 'every head in the meadow drawn open',
      caught: !(Math.abs(1.0 - censo.head.openShare) < 0.02) },
    { what: 'a head at fourteen centimetres',
      caught: !(0.14 >= 0.030 && 0.14 <= 0.075) },
    // U-FIORI-7: the meadow the committente walked away from, injected head by
    // head. Every one of these passed every gate this file had before that turn.
    { what: 'the head back at the seven and a half centimetres of E-FIORI5',
      caught: !(0.060 >= 0.030 && 0.090 <= 0.075) },
    { what: 'a head at two centimetres, which is a meadow with no flowers in it',
      caught: !(0.015 >= 0.030 && 0.025 <= 0.075) },
    { what: 'a band of the meadow drawn a third too big',
      caught: !(Math.abs((TAGLIA_PX['7-10'] * 1.33) / TAGLIA_PX['7-10'] - 1) <= TAGLIA_TOLL) },
    { what: 'a band of the meadow gone empty',
      caught: !(Math.abs(0.4 / censo.sowing.perSquareMetre - 1) <= DENSITA_TOLL) },
    { what: 'a band sown twice as thick as the rest',
      caught: !(Math.abs(6.0 / censo.sowing.perSquareMetre - 1) <= DENSITA_TOLL) },
    { what: 'a sowing that went back to a scatter with no groups in it',
      caught: !(1.0 >= 0.55 && 1.0 <= 0.75) },
    { what: 'a sowing heaped into piles, which is not grouping either',
      caught: !(0.30 >= 0.55 && 0.30 <= 0.75) },
    { what: 'the one per cent of blue the delivered picture showed',
      caught: !(0.01 >= 0.12 && 0.01 <= 0.18) },
    { what: 'a meadow a third of it blue',
      caught: !(0.33 >= 0.12 && 0.33 <= 0.18) },
    { what: 'the blues trimmed at eight metres again, where the census stopped seeing them',
      caught: !(8.0 >= censo.reach.far) },
    { what: 'a white head ten levels under the target\'s own lid',
      caught: !(Math.abs((BERSAGLIO_LID.L - 10) - BERSAGLIO_LID.L) <= 5) },
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
