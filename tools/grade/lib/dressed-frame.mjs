// Waiting for the world to be in the frame, instead of waiting for a clock.
//
// A capture script that sleeps for a fixed number of seconds and then shoots
// has no way of noticing that the sleep stopped being long enough. Twice in one
// campaign that produced a full survey — twenty eight poses each time — of
// frames nothing was wrong with except that they carried no world: once the
// bare dome alone, sky and nothing else, and once pure black with the WebGL
// context alive, `isContextLost()` false and not one error on the console. Both
// runs reported success and the defect was found by measuring the files
// afterwards, which is the worst possible place to find it.
//
// So the wait is on a CONDITION, and the condition is two numbers a frame with
// the world in it has and that neither a smooth dome nor a black buffer can
// fake:
//
//   * MEAN luminance rules out black, which reads zero;
//   * its DEVIATION rules out the bare dome, because a frame with the world in
//     it has dark ground under a bright sky and a gradient does not.
//
// The floors below sit wide of the measured values on both sides rather than
// being chosen to look safe: a good frame at the reference pose reads mean
// 110.5 with deviation 56.2, the discarded bare dome read 148.8 and 15.0, and
// the black read 0.0 and 0.0. Anything between 25 and 56 of deviation is a
// frame this cannot judge, and there has never been one.
//
// This does not replace the settle time a capture already spends: a frame can
// be healthy and not yet settled, so the wait is an extra one and callers keep
// their warm-up renders. And it holds no browser driver of its own — the caller
// owns the page and passes in how to render and how to read back, because the
// two campaigns that needed this guard drove the page in two different ways and
// a guard that only fits one driver is a guard that gets copied instead of
// imported.

/** Floors for {@link waitForDressedFrame}, and what they are wide of. */
export const DRESSED_FRAME = {
  meanFloor: 20,
  deviationFloor: 25,
  // How long to keep asking before giving up, and how long between asks. The
  // budget is generous because the failure it guards against costs a whole
  // survey: a capture that waits fifteen minutes and then shoots a good frame
  // is cheaper than one that shoots a bad frame at once.
  timeoutMs: 900000,
  pollMs: 15000,
};

// Read back the canvas and reduce it to those two numbers, in the page.
//
// The readback is downsampled to a thumbnail on purpose: mean and deviation of
// a luminance field do not need every pixel, and a full-size `getImageData` on
// a software rasteriser costs seconds per poll. Drawing the canvas into a
// second one also goes through the same compositing path a saved frame does, so
// what this measures is what would land in the file rather than what the GL
// buffer happens to hold.
export const readDressedFrame = () => {
  const canvas = document.querySelector('canvas');
  const thumb = document.createElement('canvas');
  thumb.width = 160;
  thumb.height = 90;
  const context = thumb.getContext('2d');
  context.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  const pixels = context.getImageData(0, 0, thumb.width, thumb.height).data;
  const count = thumb.width * thumb.height;
  let sum = 0;
  let squares = 0;
  for (let i = 0; i < count; i++) {
    const luminance = 0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2];
    sum += luminance;
    squares += luminance * luminance;
  }
  const mean = sum / count;
  return { mean, deviation: Math.sqrt(Math.max(0, squares / count - mean * mean)) };
};

/**
 * Block until the frame carries the world, or throw saying which failure it is.
 *
 * Throwing rather than returning false is the point: the two runs this exists
 * for both ended with a directory of files and a success message, and a capture
 * that stops loudly at the first pose costs minutes where one that carries on
 * costs the whole survey and the day spent measuring it.
 *
 * @param {object} driver
 * @param {() => Promise<{mean: number, deviation: number}>} driver.measure
 *        Render the settling pose and evaluate {@link readDressedFrame} in the page.
 * @param {(ms: number) => Promise<void>} driver.wait  Sleep, in the driver's own way.
 * @param {(message: string) => void} [driver.report]  Where the polling line goes.
 * @param {object} [limits]  Overrides for {@link DRESSED_FRAME}.
 * @returns {Promise<{mean: number, deviation: number}>} the reading that passed.
 */
export async function waitForDressedFrame({ measure, wait, report = () => {} }, limits = {}) {
  const {
    meanFloor, deviationFloor, timeoutMs, pollMs,
  } = { ...DRESSED_FRAME, ...limits };
  const deadline = Date.now() + timeoutMs;
  let reading = await measure();
  while ((reading.mean < meanFloor || reading.deviation < deviationFloor) && Date.now() < deadline) {
    report(`  waiting for the world: mean ${reading.mean.toFixed(1)}, deviation ${reading.deviation.toFixed(1)}`);
    await wait(pollMs);
    reading = await measure();
  }
  report(`  dressed-frame guard: mean ${reading.mean.toFixed(1)}, deviation ${reading.deviation.toFixed(1)}`);
  // Two messages and not one, because the two failures have different causes
  // and a capture that says which one it hit is a capture whose operator knows
  // whether to restart the browser or to look at the asset delivery.
  if (reading.mean < meanFloor) {
    throw new Error(`BLACK CAPTURE: mean ${reading.mean.toFixed(1)} — the frame carries nothing`);
  }
  if (reading.deviation < deviationFloor) {
    throw new Error(`WORLD NOT DRESSED: deviation ${reading.deviation.toFixed(1)} — the dome is there and the world is not`);
  }
  return reading;
}
