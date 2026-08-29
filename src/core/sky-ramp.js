// THE RAMP'S ARITHMETIC, AND NOTHING ELSE.
//
// This file exists so that the sky the frame DRAWS and the sky the tools MODEL
// are the same arithmetic rather than two copies of it that agree today.
//
// The campaign has already paid for that distinction once. V6-DEV1 delivered
// the ramp in src/core/sky.js and a twin of it in a measuring script, and the
// residue was a standing hazard written into the session record: the cloud bake
// SUBTRACTS what the model returns and the fragment ADDS BACK what the shader
// returns, so any disagreement between the two lands in the frame as a halo
// around every cloud — a defect that looks like art direction and is arithmetic.
// E-V6g ordered the twin carried into tools/grade/lib/sky-model.mjs. Carrying it
// as a SECOND IMPLEMENTATION would have re-armed the same trap one level down,
// so what is carried is this: one module, no dependency on three.js and none on
// node, imported by the shader's own uniforms on one side and by the offline
// model on the other. It follows src/world/voxel/pure.js, which is the same
// answer to the same problem for the ground.
//
// Nothing here reads a file. A preset arrives as an argument, exactly as it
// does at setSkyPreset, so the read-from-disk contract that U-V7-B consumes for
// the night tints (E-V7h) is untouched by anything in this file.

/**
 * How high a direction is, as the ramp measures height.
 *
 * The parameter of the mix is a power of the SINE of the elevation, which is
 * the vertical component of a unit direction and therefore arrives free — the
 * ramp is stated in that variable rather than in degrees for exactly that
 * reason, and no arcsine is taken anywhere in the hot path.
 *
 * Below the horizon the mix is held at nought, and that join is SMOOTH rather
 * than clamped: the knee is a power well above one, so the mix leaves the
 * horizon with nought slope already and meeting a constant there costs no
 * crease. A clamp is what drew a line across the equator of the old sky.
 *
 * @param {number} sinElevation the vertical component of a unit direction
 * @param {number} knee the power the mix rises through
 * @param {number} gain bends the mix between its ends without moving either
 * @returns {number} the mix parameter, nought at the horizon and one at the zenith
 */
export function rampMix(sinElevation, knee, gain) {
  const y = Math.min(1, Math.max(0, sinElevation));
  const s = 1 - (1 - y) ** knee;
  return ((1 + gain) * s) / (1 + gain * s);
}

/**
 * THE BEND, which is how a third anchor reaches a fragment.
 *
 * E-V6i approved a middle tint for the day and fixed the preset's format before
 * the night keys were written, so that the format would be paid for once: a
 * ramp carries UP TO THREE anchors — `zenith`, an optional `mid` at
 * `midElevation`, and `horizon`.
 *
 * The curve through them is a QUADRATIC IN THE MIX PARAMETER:
 *
 *     C(t) = H + (Z - H) t + K t (1 - t)
 *
 * with K the one vector that makes C(tm) = M. Three properties earn it the job,
 * and the third is the one that matters:
 *
 *  1. It costs one multiply-add per channel, and K is computed here rather than
 *     in the fragment, so the shader adds a term and never learns why.
 *  2. It is smooth. The other law U-V7-B fitted — two mixes joined at tm —
 *     is cheaper still, but its DERIVATIVE steps at the joint, and a step of
 *     derivative in a gradient this smooth is a Mach band, which is precisely
 *     the defect a ramp was chosen to be free of. In the event the argument
 *     was never needed: fitted side by side on the day, the quadratic came back
 *     at 6.71 against the piecewise 6.86, so it won on the number as well and
 *     nothing had to be traded for the smoothness.
 *  3. A COLLINEAR MIDDLE ANCHOR IS AN EXACT NO-OP, not nearly one. Put M on the
 *     segment, M = H + (Z - H) tm, and the numerator of K is identically nought
 *     — no cancellation of large numbers, no residue at the eighth decimal. That
 *     is what makes E-V6i's soft retreat real: if the client vetoes the third
 *     tint, the anchor is written collinear and the sky is the two-tint ramp bit
 *     for bit. U-V7-B has already delivered the night that way.
 *
 * @param {object} ramp a preset's ramp block
 * @returns {number[]} the bend vector, all noughts when there is no third anchor
 */
export function rampBend(ramp) {
  if (!ramp.mid || typeof ramp.midElevation !== 'number') return [0, 0, 0];
  const tm = rampMix(Math.sin((ramp.midElevation * Math.PI) / 180), ramp.knee, ramp.gain);
  // An anchor at either end of the mix does not name a curve — the segment
  // already passes through both — and dividing by tm(1-tm) there is a division
  // by nought. A preset that asks for one gets the segment rather than a NaN
  // sky, because a sky of NaN is a black frame and a black frame is reported as
  // a driver fault by whoever meets it next.
  if (!(tm > 1e-6) || !(tm < 1 - 1e-6)) return [0, 0, 0];
  return ramp.horizon.map((h, c) => (
    (ramp.mid[c] - h - (ramp.zenith[c] - h) * tm) / (tm * (1 - tm))
  ));
}

/**
 * The tint the ramp carries in one direction, before the exposure.
 *
 * @param {object} ramp a preset's ramp block
 * @param {number} sinElevation the vertical component of a unit direction
 * @param {number[]} bend rampBend(ramp), passed in so a loop computes it once
 * @param {number[]} out
 */
export function rampTint(ramp, sinElevation, bend, out = [0, 0, 0]) {
  const t = rampMix(sinElevation, ramp.knee, ramp.gain);
  const w = t * (1 - t);
  for (let c = 0; c < 3; c++) {
    out[c] = ramp.horizon[c] + (ramp.zenith[c] - ramp.horizon[c]) * t + bend[c] * w;
  }
  return out;
}

/**
 * THE WHOLE SKY IN ONE DIRECTION — the twin of skyDome() in src/core/sky.js.
 *
 * The sharpness is how much of the sun survives: one for a mirror and for the
 * dome, less for a surface that scatters what it reflects. The ramp itself does
 * not blur, having no detail a rough face could lose, so the sharpness reaches
 * only the two narrow things — it shortens the aureole's lobe and spreads the
 * disc.
 *
 * @param {object} preset an entry of sky.json of the shape `day` has
 * @param {number[]} direction need not be normalised
 * @param {number[]} out
 * @param {number} sharpness
 * @param {number[]} bend rampBend(preset.ramp); computed here when not supplied
 */
export function rampRadiance(preset, direction, out = [0, 0, 0], sharpness = 1, bend = null) {
  const ramp = preset.ramp;
  const len = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  const tint = rampTint(ramp, direction[1] / len, bend || rampBend(ramp));

  // THE SUN VECTOR IS NORMALISED HERE BECAUSE setSkyPreset NORMALISES IT THERE.
  //
  // It is not unit as it stands on disk: sky.json serialises it to six decimals,
  // which leaves it 1,2e-6 short. The shader never sees that, because the door
  // calls .normalize() on the way in; a twin that skipped the step would carry
  // a cosine 1,2e-6 out, and the cos^40 lobe multiplies an error in the cosine
  // by forty. Small — but "small" is what the halo round every cloud is made
  // of, and the whole reason this module is imported by both sides rather than
  // written twice is that neither side gets to be nearly right.
  const s = preset.sun.vector;
  const sl = Math.hypot(s[0], s[1], s[2]) || 1;
  const c = (direction[0] * s[0] + direction[1] * s[1] + direction[2] * s[2]) / (len * sl);
  const forward = Math.max(0, c);

  // The aureole keeps the energy it carries as it widens, exactly as the
  // physical lobe did: cos^n integrates to 2*pi/(n+1) over the hemisphere, so
  // spreading one without taking its peak down would MAKE light rather than
  // move it — and at the roughness the stone asks for that was sixty times, and
  // it drew every rock in the world as a pale slab against the sky.
  const n = ramp.glowExponent;
  const peak = n * sharpness;
  const glow = ramp.glow * ((peak + 1) / (n + 1)) * forward ** peak;

  const spread = 1 / Math.sqrt(Math.max(1e-4, sharpness));
  const gamma = (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI;
  const edge = preset.disc.radiusDeg * spread;
  const soft = preset.disc.softDeg * spread;
  const x = Math.min(1, Math.max(0, (gamma - (edge - soft)) / (2 * soft)));
  const disc = (1 - x * x * (3 - 2 * x)) * preset.disc.level * sharpness;

  // The disc takes the MEAN of the three exposures and not each of them, for
  // the reason the physical dome took it: a beam carrying the picture's white
  // balance is a beam a third as red as it is blue, which the tone curve hides
  // on the disc, where everything saturates, and does not hide in the bloom.
  const beam = (preset.exposure[0] + preset.exposure[1] + preset.exposure[2]) / 3;
  for (let ch = 0; ch < 3; ch++) {
    out[ch] = preset.exposure[ch] * (tint[ch] + glow) + beam * disc;
  }
  return out;
}
