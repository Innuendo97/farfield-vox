import {
  DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, RepeatWrapping,
} from 'three';

// THE GRAIN INSIDE A FACE, AND THE SEAT IT SITS IN.
//
// WHAT THIS ANSWERS. Research C measured, on the same window with the same
// instrument, that every material of the reference carries a light and dark
// INSIDE one face of a cube which this render does not have at all: bare earth
// 2.40% of luminance against our 0.51%, the paving 3.20 against 1.18, the near
// meadow 1.16 against 0.43. Its map of the instrument shows the difference
// without a number -- on the reference the detector is lit everywhere, on ours
// it is lit only along the seams between cubes and inside the faces it is
// black. Our faces are flat by construction: the fragment of the soil did not
// declare a single sampler.
//
// THE FORM, AND WHY IT IS AN ARRAY AND NOT AN ATLAS. One `sampler2DArray`, R8,
// sixteen texels a side, one layer a family and orientation. An atlas would
// need a gutter round every tile -- eight texels a side at four mip levels is
// what a block world spends, which turns a 1024 atlas from 4 096 tiles into
// 1 024 -- because the filter of a minified tile reaches across its own border
// and fetches the neighbour. An array has no border to reach across: each slice
// is a texture, the filter never leaves it, and the sample costs exactly the
// same. The layer is arithmetic on a material constant and on the normal that
// is ALREADY a vertex attribute, so guard-vertice stays green: nothing per
// voxel is stored, and the greedy merge that lets one rectangle stand for a
// hundred cubes is untouched.
//
// ONE READ A FRAGMENT, AND IT IS ONE READ BECAUSE THE COLOUR IS NOT IN IT.
// The sheet is grey and the pigment stays exactly where it was -- the field in
// src/world/voxel/pigment.js, rebuilt in the fragment from the cube's own cell,
// zero bytes and zero reads. The sheet multiplies it:
//
//     albedo = pigment(cell) * (1 + gain * (grey - 0.5)) * joint
//
// which is the architecture a block world uses to get a thousand greens out of
// one grass texture, and the reason a texture here costs no read more than an
// atlas would have. The pigment's pure twin never sees this file: E-PIG1's rule
// is that the twin answers for the TINT, and the grain is a separate factor
// that multiplies it. Neither can quietly become the other.
//
// AND THE MEAN OF EVERY SHEET IS A HALF, WHICH IS THE ONE RULE. Past two pixels
// a texel the sampler climbs the mip chain, and at the top of it a texture
// returns the mean of itself. So at range the world is made of the MEANS of its
// sheets: a sheet whose mean is not the neutral repaints the whole distance.
// Half is the neutral of the line above. It is bought in the deriving tool by
// choosing which texels round up (tools/materia/foglio.mjs) and it is checked
// by tools/guards/guard-tile-media.mjs, in both directions.

/** The strip, and the order the layers stand in it. */
export const SHEETS = {
  side: 16,
  // The layers this unit paints, in the order tools/materia/foglio.mjs writes
  // them into assets-src/materia/soil-sheets.png -- one under the next, so a
  // layer is a contiguous run of 256 bytes and slicing it here is an offset.
  layers: ['grass-top', 'grass-side', 'earth', 'paving'],
};

/**
 * Which slice a family reads, by family and by orientation.
 *
 * THE STONE IS NOT HERE AND THAT IS DELIBERATE. The monoliths and the rocks are
 * V2's, they live on another branch and they are measured against another half
 * of the dossier (C 1.3 and 1.4, and the specular below). The seat is what this
 * unit leaves them: two more entries in this table, two more cuts in
 * assets-src/materia/fogli.json, and the strip grows by 256 bytes a layer.
 * Nothing in the fragment, the guard or the delivery has to change for that.
 */
export const LAYER = {
  grassTop: 0, grassSide: 1, earth: 2, paving: 3,
};

/** What each family's pair of layers is, top first. */
export const FAMILY_LAYERS = {
  meadow: [LAYER.grassTop, LAYER.grassSide],
  earth: [LAYER.earth, LAYER.earth],
};

/**
 * The array texture, sliced out of the one picture the delivery carries.
 *
 * WHY THE DELIVERY IS A STRIP AND THE SLICING HAPPENS HERE. `ktx create` takes
 * `--layers` and would ship a layered file directly, but three's KTX2 loader
 * rebuilds a layered container only through the Basis transcoder -- the
 * uncompressed path returns a flat DataTexture and drops the layer count on the
 * floor. Putting a block codec on a sixteen texel square to reach that path
 * would be answering an exact question with a lossy answer, and the answer that
 * matters -- the mean of every layer -- is exactly the one a block codec moves.
 * So the strip travels as one uncompressed R8 picture, sixteen wide, and is cut
 * into slices here. It is 1 930 bytes of source, 1 247 delivered, and that is
 * the whole of what this texture costs on the wire -- the first weight of an
 * atlas this campaign has ever measured rather than estimated (C 6.7 left it
 * open, and the literature's own figure for twenty layers was 15 to 40 kB;
 * four layers cost 1 247 B, so twenty would cost about six).
 *
 * THE MIP CHAIN IS THE DRIVER'S, AND FOR AN ARRAY THAT IS THE RIGHT ANSWER.
 * `generateMipmap` on a 2D array filters every slice on its own -- that is the
 * property the array was chosen for -- and on a power of two square it is the
 * same 2x2 box the deriving tool uses to prove the last level is a half.
 *
 * @param {import('three').Texture} strip what the loader returns for the id
 *                                        'soil-sheets': 16 x 16*N, one channel
 * @param {number} layers how many slices are in it
 */
export function sheetArray(strip, layers = SHEETS.layers.length) {
  const side = SHEETS.side;
  const source = strip?.image?.data;
  if (strip && (!source || source.length < side * side * layers)) {
    throw new Error(`soil-sheets is ${source ? source.length : 0} bytes, `
      + `not the ${side * side * layers} the strip needs`);
  }
  // A copy and not a view: the loader's buffer may be released, and the upload
  // wants the layers contiguous in the order the array reads them, which they
  // already are. With no strip at all every texel is the neutral, so a material
  // built before the delivery has landed draws the world that shipped before
  // this sheet existed instead of a black one.
  const data = source
    ? new Uint8Array(source.subarray(0, side * side * layers))
    : new Uint8Array(side * side * layers).fill(128);
  const texture = new DataArrayTexture(data, side, side, layers);
  texture.format = RedFormat;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  // LINEAR IN MAGNIFICATION, and this is not the block world's `nearest`. A
  // voxel here is ten centimetres and not a metre: at the pose that judges, a
  // cube is twenty pixels and a texel of a sixteen sheet is one and a quarter,
  // so magnification barely happens and what the frame lives on is the mip
  // chain. Nearest would buy a crisp texel nobody can see and cost a staircase
  // on every face the walker leans into.
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  // The ground is read at a grazing angle over most of the frame, which is the
  // one case where the footprint is long in one direction and short in the
  // other and a single mip level has to be wrong in one of them.
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The chunk, and the three things it declares.
 *
 * It is written once and included by every material that wants a grain, for the
 * reason every shared chunk in this world is written once: two copies of ten
 * lines is how two families come to disagree about what a face coordinate is.
 */
export const SHEET_GLSL = /* glsl */`
  uniform sampler2DArray tSheets;
  // The slice for a top face and for a flank, and how much of each is worth.
  uniform vec2 uSheetLayer;
  uniform vec2 uSheetGain;
  // Nought takes the whole term out, which is what a bench needs to weigh it.
  uniform float uSheetOn;
  // How many repeats of a sheet go into a metre, for the surfaces that are not
  // made of cubes and have no face to lay one on. Held as a uniform and not
  // written into the program because it is a SCALE, and a scale is the one thing
  // that has to be swept against the reference rather than reasoned about.
  uniform float uSheetPerMetre;

  // WHERE ON ITS OWN FACE THIS FRAGMENT STANDS, in [0,1] squared.
  //
  // It is the same fract() the joint is already built on, with the axis the
  // face looks along dropped -- a face has two dimensions and the third would
  // always be nought or one. So it adds no varying, no attribute and no draw:
  // it is arithmetic on a position that was already in the fragment.
  vec2 sheetFaceUv(vec3 p, vec3 n, float voxel) {
    vec3 f = fract(p / voxel);
    vec3 a = abs(n);
    return mix(mix(f.xy, f.xz, step(0.5, a.y)), f.zy, step(0.5, a.x));
  }

  // A DIFFERENT PATCH OF THE SHEET ON EVERY CUBE, which is what actually keeps a
  // meadow from being one motif ten thousand times.
  //
  // FOUR QUARTER TURNS AND A FLIP WERE TRIED FIRST AND ARE NOT ENOUGH, measured
  // rather than argued: eight copies of one blob is still one blob, and at the
  // gain that lands the reference's own per cent the near meadow read as
  // wallpaper. What breaks it is a SLIDE, and a slide is only available because
  // the sheet was synthesised out of its own Fourier coefficients and therefore
  // closes on itself at every edge (tools/materia/foglio.mjs). A cut of a
  // photograph would have drawn its own join across every face.
  //
  // The turns stay as well, because they cost two selects and they decorrelate
  // the direction of the mottle as well as its place.
  vec2 sheetLay(vec2 uv, vec2 draw) {
    float t = floor(draw.x * 8.0);
    vec2 a = mix(uv, vec2(uv.y, 1.0 - uv.x), step(0.5, mod(t, 2.0)));
    vec2 b = mix(a, vec2(1.0) - a, step(0.5, mod(floor(t * 0.5), 2.0)));
    vec2 c = mix(b, vec2(1.0 - b.x, b.y), step(4.0, t));
    return c + vec2(draw.y, fract(draw.y * 7.31));
  }

  // THE READ, WITH THE FOOTPRINT HANDED IN RATHER THAN GUESSED.
  //
  // The footprint is how much ground one screen pixel covers, taken off the SMOOTH
  // position in the fragment that calls this. It has to be, and the reason is
  // the same one written over the joint's own width: the derivative of a fract
  // is a cliff at every cube boundary, and a sampler that chose its mip level
  // from the wrapped coordinate would pick the last level along every seam and
  // draw a blurred lattice over the whole meadow. Handed the true footprint,
  // the level is right everywhere including on the seam.
  float sheetGrey(vec2 uv, float layer, float footprint) {
    return textureGrad(tSheets, vec3(uv, layer),
      vec2(footprint, 0.0), vec2(0.0, footprint)).r;
  }

  // And the whole term, as the one line the architecture is: a modulation with
  // mean one, over a pigment that is not touched.
  float sheetGrain(vec3 p, vec3 n, float voxel, float pixel, vec2 draw) {
    float top = step(0.5, abs(n.y));
    float layer = mix(uSheetLayer.y, uSheetLayer.x, top);
    float gain = mix(uSheetGain.y, uSheetGain.x, top) * uSheetOn;
    vec2 uv = sheetLay(sheetFaceUv(p, n, voxel), draw);
    // AND IT MAY NOT GO BELOW NOUGHT. A modulation of mean one is still a
    // multiplier, and a multiplier under nought is a NEGATIVE albedo: read on
    // the sweep at a gain of three, the darkest texels put the red and the
    // green of a pixel below zero and the frame answered with specks of the
    // air's own blue, because that channel was the only one left. The floor
    // costs one instruction and it is the difference between a term that is
    // too strong and a term that is broken.
    return max(0.0, 1.0 + gain * (sheetGrey(uv, layer, pixel / voxel) - 0.5));
  }

  // AND THE SAME SHEET LAID OVER THE GROUND INSTEAD OF OVER A FACE, which is
  // what a surface that is not made of cubes needs. The corridor is one
  // continuous skin with its own law of slabs; a face coordinate would be a
  // lattice it does not have. So the coordinate is the world's own, turned and
  // divided by a repeat.
  //
  // THE FOOTPRINT IS HANDED IN HERE TOO, and it has to be, because the caller
  // turns the sheet PER SLAB: the lay jumps at every joint, and a sampler
  // choosing its level off that jump would draw a blurred line down every one
  // of them. It is the same cure the cubes use for the same disease.
  float sheetOver(vec2 uv, float layer, float gain, float footprint) {
    return max(0.0, 1.0 + gain * uSheetOn * (textureGrad(tSheets, vec3(uv, layer),
      vec2(footprint, 0.0), vec2(0.0, footprint)).r - 0.5));
  }
`;

/**
 * THE LUCENTEZZA, ANALYTIC, WITH NO MAP AND NO READ -- AND OFF ON THE SOIL.
 *
 * C 1.3 measured the thing this answers: the sunlit flank of monolith 03 stands
 * at L 127.5 with a saturation of 0.107, and its own shaded front -- the same
 * stone read by the sky alone -- at L 38.1 with 0.667. A purely diffuse face is
 * albedo times light and keeps its pigment whatever the light does; a face that
 * has lost its colour and taken the light's has a specular term on it. That is
 * a fact about STONE, and stone is V2's on another branch.
 *
 * IT IS HERE, OFF, FOR ONE REASON: it is five instructions and no texture, and
 * the alternative to writing it here was writing it twice later. The reference
 * shows no gloss whatever on grass or on earth -- their sunlit faces keep their
 * colour -- so the soil's materials never call it, and `uSheetOn` has no
 * companion knob for it on purpose.
 *
 * THE NUMBERS, AND WHERE THEY COME FROM. F0 is 0.04, which is what a dielectric
 * is worth and is not a taste: a strong white highlight on a dielectric is the
 * signature of plastic. The exponent is a constant per family -- C 3.5 tabulates
 * dry stone at roughness 0.75-0.95 and polished stone in the gap at 0.25-0.45,
 * which through n = 2/roughness^4 - 2 is about 245 at 0.30 and 76 at 0.40 --
 * and the dossier's own recommendation to the committente (Q2b) is the tenuous
 * one, an exponent near 80. AND THE NORMALISATION IS NOT OPTIONAL: without
 * (n+8)/8 a shinier surface gets a narrower lobe AND a fainter one, so raising
 * the gloss makes the stone DARKER, which is the opposite of what it is for. At
 * n = 80 that factor is 11.0.
 *
 * THE EXPONENT SHIPS AS 80 AND THAT IS C'S OWN RECOMMENDATION (Q2b), not a
 * choice made here: "speculare tenue, esponente circa 80 -- pietra levigata ma
 * opaca: un velo che si accende quando ci si mette di fronte". At 80 the
 * normalisation is 11.0.
 *
 * A single frame cannot separate this from a paler albedo -- on a flat face the
 * angle is constant across the whole face, which is why C 1.3 found the flank's
 * two-to-one ramp to be something else entirely and handed it to B. So the
 * amount is the committente's (Q2) and the judging is done WALKING.
 */
export const STONE_SHINE = 80.0;

export const SHEEN_GLSL = /* glsl */`
  // Blinn-Phong, normalised, on a dielectric. Zero texture reads.
  vec3 sheenOf(vec3 n, vec3 view, float shine, vec3 sunColour) {
    // Not called "half": that word is reserved in this shading language and a
    // program that uses it does not compile, silently, into a black surface.
    vec3 hv = normalize(uSunDir + view);
    float lobe = pow(max(dot(n, hv), 0.0), shine);
    return sunColour * (0.04 * ((shine + 8.0) / 8.0) * lobe);
  }
`;

/** The uniforms the chunk takes, from one family's pair of layers and gains. */
export function sheetUniforms(texture, layers, gains, perMetre = 1) {
  return {
    tSheets: { value: texture },
    uSheetLayer: { value: layers },
    uSheetGain: { value: gains },
    uSheetOn: { value: 1 },
    uSheetPerMetre: { value: perMetre },
  };
}

/**
 * HOW MUCH GROUND ONE REPEAT OF THE PAVING'S SHEET COVERS, in metres.
 *
 * 0.40, swept and not chosen -- and the sheet is laid PER SLAB, which is the
 * thing that had to be settled before the number meant anything.
 *
 * Inside one slab at six metres the reference's grain has features two to four
 * pixels across, which at 16.5 px to a voxel is 1.2 to 2.4 cm; sixteen texels
 * over forty centimetres is 2.5 cm a texel. Read at the pose that judges, the
 * corridor's two windows move from (1.11, 1.22) to (2.48, 3.05) against the
 * reference's (2.27, 3.20).
 *
 * AND THE FIRST TWO ANSWERS WERE BOTH WRONG IN WAYS ONLY THE EYE COULD SEE.
 * Laid straight over the run, the sheet read as CORRUGATION -- a ripple down
 * the whole corridor -- and 25, 55 and 90 centimetres all read the same way, so
 * it was the content and not the period: a cut of one slab holds the streaking
 * ALONG that slab, and a streak tiled over a hundred metres is a ripple. Turned
 * by the slab's own level it came back as SPECKLE, 4.6% where the reference
 * reads 2.2, because the level arrives through a linear filter and a fraction
 * of thirty times its own value is a different lay at every pixel. Rounded to
 * sixteen buckets the lay is constant on a piece, and the grain of a stone runs
 * with the stone it is in and turns at every joint, which is what the reference
 * shows.
 *
 * AND IT IS TURNED, on the corridor's own nineteen degrees, for the reason
 * path.js gives for turning its own tile: a repeat laid square with the run
 * comes back every forty centimetres as the walker steps down it, and the turn
 * is what costs the repeat its period along the walk.
 */
export const PAVING_SHEET_METRES = 0.40;
