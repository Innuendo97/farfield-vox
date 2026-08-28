import { setCloudDrift, setCloudSky } from '../../core/sky.js';
import { CLOUD_LEVEL, createClouds } from '../clouds.js';

// THE SKY AND THE WEATHER. Owned by V6.
//
// The dome itself is not here: it is arithmetic in src/core/sky.js and it goes
// up with the scene, before any delivery, so that the walker's first frame has a
// finished sky in it rather than a clear colour standing in for one. What is
// here is the weather -- bodies standing in FRONT of that dome -- which can be
// hung a moment later without anybody ever waiting on a sky.
//
// WHAT V6 REPLACES IT WITH: the optics of the dome (the third step of the light
// refit, under a written invariant -- irradiance within five per cent, no more,
// without an amendment to the campaign), and an atlas recut to silhouettes of
// cubes. The tiles, the placements and the model of the motion all stay.
//
// UASTC AND NEVER ETC1S for that atlas, and it is not a preference: a block
// codec cannot hold a block that is part cloud and part nothing, and every texel
// of clear sky it lifts above nought is a square of false cloud the frame blends
// over open blue.
const layer = {
  id: 'v6-cielo-nuvole',

  meshes: [],

  clouds: null,

  plant: {
    needs: ['cloud-sprites', 'cloud-cover', 'cloud-equirect'],

    build(assets) {
      layer.clouds = createClouds({
        clouds: assets['cloud-sprites'],
        // The silhouette, on its own: see the note over the coverage profile in
        // tools/build-assets.mjs for why it does not travel in the colour atlas.
        cover: assets['cloud-cover'],
        // The generated table and its textures, which are asked for by name and
        // allowed not to be there. It is not in `needs` because it is the one
        // asset whose very presence is the switch between two fields, and the
        // number of textures that follow it is written inside it: a list here
        // would be a second copy of a decision taken when the volumes were
        // packed. src/main.js fetches it and hands the result through.
        relit: assets.relit,
        blockers: assets.blockers,
        frozen: assets.frozen,
      });
      layer.meshes = layer.clouds.meshes;
      // The same weather, for everything that reflects the sky rather than
      // stands in front of it. It arrives with the atlas because it is the same
      // bake, and until it does those surfaces reflect an empty sky.
      setCloudSky(assets['cloud-equirect'], CLOUD_LEVEL);
      return layer.clouds;
    },
  },

  /** Development handle: the weather alone, which is the other thing that fills. */
  setVisible(visible) {
    if (layer.clouds) layer.clouds.setVisible(visible);
  },

  /** And one layer of it at a time, because the whole field is one draw. */
  setLayers(kinds) {
    if (layer.clouds) layer.clouds.setLayers(kinds);
  },

  /** The air in front of the weather, for the fit and for a day and night. */
  setAerial(...values) {
    return layer.clouds ? layer.clouds.setAerial(...values) : null;
  },

  /** How much of that air this delivery has not already got baked into it. */
  setAerialOwed(owed) {
    return layer.clouds ? layer.clouds.setAerialOwed(owed) : null;
  },

  /** The level the weather is read at, for the sweep that settles the gain. */
  setLevel(scale) {
    return layer.clouds ? layer.clouds.setLevel(scale) : null;
  },

  /** Development handle: what the weather's own clock reads, in seconds. */
  seconds() {
    return layer.clouds ? layer.clouds.seconds() : 0;
  },

  update({ elapsed }) {
    if (!layer.clouds) return;
    layer.clouds.update(elapsed);
    // The drift is a rigid turn of the whole field, so everything that reflects
    // the sky is handed the one number that describes it rather than the field.
    setCloudDrift(layer.clouds.turns());
  },
};

export default layer;
