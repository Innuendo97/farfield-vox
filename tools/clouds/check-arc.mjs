// The assertions that would have caught the arc missing the sun.
//
//   node tools/clouds/check-arc.mjs
//
// The defect it exists for was not subtle and not hard to test — the arc every
// piece is baked along did not contain the direction the world is lit from, and
// eight and a third degrees of it went unnoticed through a design, a production
// plan and a delivery, because nothing ever asked. It cost two dozen volumes.
//
// So it is asked here, cheaply, and anything that reads the arc can run this
// first. Exits non-zero on any failure, so it can gate a bake.

import { sunVec as volumeSunVec } from './cloud-volume.mjs';
import { PROD_SUN } from './cloud-pieces.mjs';
import {
  arcParams, arcParamOf, CUT, INC, offPlane, planesFor, POLE_AZ, poleAzimuthFor, sunVec,
} from './cloud-arc.mjs';

let failed = 0;
const check = (ok, what, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
};

// 1. The two directions-from-angles agree. This module states the convention a
// second time so that nothing in the runtime has to import the generator to use
// the arc; a second statement of a convention is exactly what produced the
// defect above, so it is checked rather than trusted.
{
  let worst = 0;
  for (let az = -180; az <= 180; az += 17) {
    for (let el = -30; el <= 80; el += 11) {
      const a = sunVec(az, el); const b = volumeSunVec(az, el);
      worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
  }
  check(worst < 1e-12, 'the arc and the generator mean the same by az/el', `worst ${worst.toExponential(1)}`);
}

// 2. The arc contains the sun the world is lit by. This is the one.
{
  const s = sunVec(PROD_SUN.az, PROD_SUN.el);
  const off = offPlane(s);
  check(off < 0.01, 'the production sun lies on the arc', `${off.toFixed(4)} degrees off the plane`);
  const exact = poleAzimuthFor(s);
  check(Math.abs(exact - POLE_AZ) < 0.001, 'the pole azimuth is the solved one',
    `solved ${exact.toFixed(4)}, stated ${POLE_AZ}`);
}

// 3. And it is not merely on the plane: it is inside the sampled stretch, and
// near enough to a sample that the compression was measured for that case.
{
  const s = sunVec(PROD_SUN.az, PROD_SUN.el);
  const t = arcParamOf(s);
  const { fine, tEnd } = arcParams();
  check(Math.abs(t) < tEnd, 'the production sun is inside the cut', `t ${t.toFixed(2)} against ${tEnd.toFixed(2)}`);
  const gap = fine.map((x) => Math.abs(x - t)).sort((a, b) => a - b)[0];
  check(gap <= 3.76, 'the production sun is within half a step of a baked plane',
    `${gap.toFixed(2)} degrees of parameter`);
}

// 4. The arc is still the shape it was designed to be.
{
  const { fine, coarse, tEnd } = arcParams();
  const planes = planesFor(fine);
  const els = planes.map((p) => p.el);
  check(fine.length === 29, 'twenty-nine directions on the fine arc', `${fine.length}`);
  check(coarse.length === 15, 'fifteen on the coarse one', `${coarse.length}`);
  check(Math.abs(tEnd - 102.43) < 0.01, 'the ends land on the crossing', `tEnd ${tEnd.toFixed(2)}`);
  check(Math.abs(Math.max(...els) - INC) < 0.6, 'it culminates at the inclination', `${Math.max(...els)}`);
  check(Math.abs(Math.min(...els) - CUT) < 0.6, 'and is cut where it says', `${Math.min(...els)}`);
  const ts = planes.map((p) => p.t);
  check(ts.every((x, i) => i === 0 || x > ts[i - 1]), 'the parameters are in order');
  let widest = 0;
  for (let i = 1; i < planes.length; i++) {
    const a = sunVec(planes[i - 1].az, planes[i - 1].el); const b = sunVec(planes[i].az, planes[i].el);
    widest = Math.max(widest, Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI);
  }
  check(widest < 7.6, 'no gap wider than the step it claims', `widest ${widest.toFixed(2)} degrees`);
}

console.log(failed ? `\n  ${failed} failure(s)` : '\n  the arc is the one the world is lit on');
process.exit(failed ? 1 : 0);
