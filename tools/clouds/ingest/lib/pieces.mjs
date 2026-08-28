// FROM ONE PLATE TO THE PIECES THE SKY STANDS.
//
// Two jobs, and they are one module because they share the same geometry.
//
// SEPARATION. Several of the sources carry three or five bodies with sky
// between them, and a sprite is one body: a window round all of them would be a
// rectangle whose middle is empty, and the frame pays for every empty texel it
// blends. So the coverage is labelled into connected components and each one
// becomes a piece. The labelling runs on a DILATED copy of the coverage — a
// cumulus is a cauliflower and its lobes are joined by veil the eye reads as
// one cloud but a threshold cuts into islands — and the dilation is small, a
// fraction of a per cent of the frame, because a generous one welds two bodies
// the photographer separated on purpose.
//
// THE WINDOW, AND WHY IT IS GROWN RATHER THAN FITTED. The atlas's whole
// silhouette argument is that coverage at a tile's border is nought: the runtime
// clamps its churn to half a texel of the first texture, the mip chain bleeds
// across the gutters, and both are safe only because there is nothing at the
// edge to bleed. A window cut tight against a cloud is a straight edge in the
// sky — the defect thirteen gates were spent on. So each window is pushed out
// until its own border rounds to nothing at eight bits, and a piece whose window
// reaches the edge of the plate before that happens is DISCARDED: it is a body
// the photograph cut, and no amount of feathering makes a cut body whole.
//
// RESAMPLING. A piece is drawn as a flat quad in the tangent plane of its own
// bearing, with a linear texture coordinate across it. A rectangle of plate
// pixels is linear in the PLATE's tangent plane, and the two planes are not the
// same plane unless the piece happens to sit on the axis — so a piece cut by
// copying pixels is a piece drawn through a projective error that grows with
// how far off-axis it was. It is one bilinear tap a texel to remove it
// completely, and then the quad's projection is the photograph's projection
// wherever the piece is asked to stand.

const DEG = Math.PI / 180;

/** East, up and the direction itself, for a bearing and a height. */
export function basisOf(azimuthDeg, elevationDeg) {
  const e = elevationDeg * DEG;
  const a = azimuthDeg * DEG;
  const forward = [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
  const right = [Math.cos(a), 0, Math.sin(a)];
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  const len = Math.hypot(up[0], up[1], up[2]) || 1;
  return { forward, right, up: up.map((v) => v / len) };
}

/** Where a direction points, in the bearing and height the rest of the sky is stated in. */
export function angleOf(d) {
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  return {
    azimuth: Math.atan2(d[0], -d[2]) / DEG,
    elevation: Math.asin(Math.max(-1, Math.min(1, d[1] / len))) / DEG,
  };
}

/**
 * The frame of a plate: its axis, its tangent half extents and how to read a
 * direction off a pixel.
 *
 * A plate is a rectilinear photograph, so its pixels ARE a tangent plane: the
 * only number needed to place them on the sphere is the angle the frame spans.
 */
export function plateFrame({
  width, height, spanDeg, azimuth = 0, elevation = 0,
}) {
  const tanU = Math.tan(spanDeg / 2 * DEG);
  const tanV = tanU * height / width;
  const { forward, right, up } = basisOf(azimuth, elevation);
  const direction = (x, y) => {
    const u = ((x / width) * 2 - 1) * tanU;
    const v = (1 - (y / height) * 2) * tanV;
    return [
      forward[0] + u * right[0] + v * up[0],
      forward[1] + u * right[1] + v * up[1],
      forward[2] + u * right[2] + v * up[2],
    ];
  };
  /** Back to pixels, from any direction in front of the plate. */
  const pixel = (d) => {
    const w = d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2];
    if (w <= 1e-6) return null;
    const u = (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / w;
    const v = (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / w;
    return [(u / tanU + 1) / 2 * width, (1 - v / tanV) / 2 * height];
  };
  return {
    width, height, tanU, tanV, forward, right, up, direction, pixel,
  };
}

/**
 * The bodies in a coverage map, one label each — and EVERY texel given to one.
 *
 * Two stages, and the second is what keeps the veil.
 *
 * The cores are found first: the texels carrying enough coverage to be cloud
 * rather than grain, joined across a small dilation because a cumulus is a
 * cauliflower whose lobes are held together by material a threshold cuts. Then
 * the labels are CARRIED OUTWARDS over the whole frame, so that every texel
 * belongs to the nearest core however faint it is. A skirt that runs to nothing
 * over two hundred texels is drawn by the body it belongs to, in full, and two
 * bodies with sky between them part along the midline rather than along either
 * one's threshold — which is a boundary the eye never sees, because there is no
 * coverage there to see.
 *
 * @returns {{labels: Int32Array, count: number, core: Uint8Array}}
 *   labels are 1-based and cover the frame; `core` marks the texels that were
 *   cloud on their own account, which is what a window is seeded from.
 */
export function separate(alpha, width, height, { live = 0.05, dilate = 4, minMass = 0 } = {}) {
  const N = width * height;
  const core = new Uint8Array(N);
  for (let i = 0; i < N; i++) core[i] = alpha[i] > live ? 1 : 0;

  const labels = new Int32Array(N);
  const dist = new Float32Array(N).fill(Infinity);
  for (let i = 0; i < N; i++) if (core[i]) dist[i] = 0;

  // One chamfer sweep each way carries both the distance and the label of the
  // nearest core, which is a Voronoi partition of the frame by body for the
  // price of the dilation that was wanted anyway.
  const relax = (i, j, d) => {
    if (dist[j] + d < dist[i]) { dist[i] = dist[j] + d; labels[i] = labels[j]; }
  };
  const sweep = () => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (x > 0) relax(i, i - 1, 1);
        if (y > 0) relax(i, i - width, 1);
        if (x > 0 && y > 0) relax(i, i - width - 1, Math.SQRT2);
        if (x < width - 1 && y > 0) relax(i, i - width + 1, Math.SQRT2);
      }
    }
    for (let y = height - 1; y >= 0; y--) {
      for (let x = width - 1; x >= 0; x--) {
        const i = y * width + x;
        if (x < width - 1) relax(i, i + 1, 1);
        if (y < height - 1) relax(i, i + width, 1);
        if (x < width - 1 && y < height - 1) relax(i, i + width + 1, Math.SQRT2);
        if (x > 0 && y < height - 1) relax(i, i + width - 1, Math.SQRT2);
      }
    }
  };
  // The distance alone first, so the dilated cores can be labelled as one.
  sweep();
  const grown = new Uint8Array(N);
  for (let i = 0; i < N; i++) grown[i] = dist[i] <= dilate ? 1 : 0;

  let count = 0;
  const stack = new Int32Array(N);
  for (let start = 0; start < N; start++) {
    if (!grown[start] || labels[start]) continue;
    count++;
    let top = 0;
    stack[top++] = start;
    labels[start] = count;
    while (top > 0) {
      const i = stack[--top];
      const x = i % width; const y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx; const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (!grown[j] || labels[j]) continue;
          labels[j] = count;
          stack[top++] = j;
        }
      }
    }
  }
  // HOW MUCH CLOUD EACH BODY ACTUALLY IS, before any of them is given a window.
  //
  // The threshold that finds a core finds a scatter of single texels as well —
  // grain that happened to land above it, and the faintest wisps of a veil,
  // which are the same size on the page and are not the same thing. The
  // separator cannot tell them apart one texel at a time and does not have to:
  // a body is a QUANTITY of cloud, so what is measured is the coverage summed
  // over the core, in texels, and a component carrying less than a stated
  // amount of it is not a piece the sky is going to stand.
  //
  // The ones that go are not cut out of the frame: their cores are cleared and
  // the carry below is done again, so whatever coverage they held goes to the
  // nearest body that survived. Nothing is thrown away, it changes hands.
  const mass = new Float64Array(count + 1);
  for (let i = 0; i < N; i++) if (core[i] && labels[i]) mass[labels[i]] += alpha[i];
  const rename = new Int32Array(count + 1);
  let kept = 0;
  for (let k = 1; k <= count; k++) rename[k] = mass[k] >= minMass ? ++kept : 0;
  if (kept !== count) {
    for (let i = 0; i < N; i++) {
      labels[i] = labels[i] ? rename[labels[i]] : 0;
      if (!labels[i]) core[i] = 0;
    }
    count = kept;
  }

  // And now outwards over everything else, from the labelled cores.
  dist.fill(Infinity);
  for (let i = 0; i < N; i++) dist[i] = labels[i] ? 0 : Infinity;
  sweep();
  return { labels, count, core };
}

/**
 * The window of one body: its own coverage, grown until its border is empty.
 *
 * @returns {{box: number[], border: number, closed: boolean, texels: number}}
 *   box is [x0, y0, x1, y1], the last exclusive; `closed` is false when the
 *   plate ran out before the coverage did.
 */
export function windowOfBody(alpha, labels, core, width, height, label, {
  // Half a step of the eight bits the atlas carries: an edge below this rounds
  // to nought, which is the property the runtime's clamp and the atlas's
  // gutters both rest on.
  quiet = 0.5 / 255, step = 8, margin = 12, reach = Infinity,
} = {}) {
  let x0 = width; let y0 = height; let x1 = 0; let y1 = 0;
  let texels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (labels[i] !== label || !core[i]) continue;
      texels++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (texels === 0) {
    return {
      box: [0, 0, 0, 0], border: 0, peak: 0, closed: false, texels: 0,
    };
  }
  const box = [
    Math.max(0, x0 - margin), Math.max(0, y0 - margin),
    Math.min(width, x1 + 1 + margin), Math.min(height, y1 + 1 + margin),
  ];
  // HOW FAR A WINDOW MAY BE PUSHED, and why there has to be a limit at all.
  //
  // Every texel of the frame belongs to some body, so a body's own coverage
  // never quite stops: a wisp at a thousandth runs on until it meets the next
  // one. Grown to quiet with no bound, two bodies a third of a frame apart each
  // take a window the size of the whole plate, and the atlas pays three times
  // for one picture. The reach is where a piece is allowed to stop looking —
  // whatever is beyond it is under the ceiling by construction, and the ceiling
  // is the rule that says what a cut costs the frame.
  const limit = [
    Math.max(0, x0 - reach), Math.max(0, y0 - reach),
    Math.min(width, x1 + 1 + reach), Math.min(height, y1 + 1 + reach),
  ];
  const value = (x, y) => {
    const i = y * width + x;
    return labels[i] === label ? alpha[i] : 0;
  };
  // JUDGED ON THE AVERAGE OF EACH EDGE AND NOT ON ITS LOUDEST TEXEL.
  //
  // What the window has to be clear of is CLOUD standing on its border, which
  // is a wall of coverage hundreds of texels long. What a plate always has on
  // its border is grain, a scatter of single texels a few parts in a thousand
  // deep, and a maximum cannot tell the two apart — a rule written on the
  // maximum would push every window out to the edge of the plate and then
  // discard the piece. The mean of an edge is a thousand independent draws of
  // that grain, so it is quiet to a part in ten thousand when there is nothing
  // there and it is the depth of the cloud when there is.
  const edges = () => {
    const rows = [0, 0];
    const columns = [0, 0];
    let peak = 0;
    for (let x = box[0]; x < box[2]; x++) {
      const top = value(x, box[1]); const bottom = value(x, box[3] - 1);
      rows[0] += top; rows[1] += bottom;
      peak = Math.max(peak, top, bottom);
    }
    for (let y = box[1]; y < box[3]; y++) {
      const left = value(box[0], y); const right = value(box[2] - 1, y);
      columns[0] += left; columns[1] += right;
      peak = Math.max(peak, left, right);
    }
    const w = Math.max(1, box[2] - box[0]);
    const h = Math.max(1, box[3] - box[1]);
    const each = {
      top: rows[0] / w, bottom: rows[1] / w, left: columns[0] / h, right: columns[1] / h,
    };
    return { border: Math.max(...Object.values(each)), each, peak };
  };
  let reading = edges();
  while (reading.border > quiet) {
    const before = box.join();
    box[0] = Math.max(limit[0], box[0] - step);
    box[1] = Math.max(limit[1], box[1] - step);
    box[2] = Math.min(limit[2], box[2] + step);
    box[3] = Math.min(limit[3], box[3] + step);
    if (box.join() === before) break;
    reading = edges();
  }
  return {
    box,
    border: reading.border,
    each: reading.each,
    peak: reading.peak,
    closed: reading.border <= quiet,
    texels,
  };
}

/** One bilinear tap of a channel-major image. */
function tap(src, width, height, channels, x, y, out) {
  const cx = Math.min(width - 1.001, Math.max(0, x - 0.5));
  const cy = Math.min(height - 1.001, Math.max(0, y - 0.5));
  const x0 = Math.floor(cx); const y0 = Math.floor(cy);
  const fx = cx - x0; const fy = cy - y0;
  const w = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  const o = [
    (y0 * width + x0) * channels, (y0 * width + x0 + 1) * channels,
    ((y0 + 1) * width + x0) * channels, ((y0 + 1) * width + x0 + 1) * channels,
  ];
  for (let c = 0; c < channels; c++) {
    out[c] = w[0] * src[o[0] + c] + w[1] * src[o[1] + c]
      + w[2] * src[o[2] + c] + w[3] * src[o[3] + c];
  }
  return out;
}

/**
 * One piece, resampled into the tangent plane of its own bearing.
 *
 * The output grid is uniform in that plane, which is what the runtime assumes
 * when it lays a linear texture coordinate across the quad. Its resolution is
 * the plate's own at the window's centre, rounded to a multiple of four texels
 * — the block the transcoder codes in, so that a tile's blocks hold that tile
 * and nothing else wherever the packer puts it.
 *
 * @param {object} plate the frame from plateFrame
 * @param {number[]} box [x0, y0, x1, y1] in plate pixels
 */
export function cutPiece(plate, box, alpha, rgb, labels, label, { fade = 0, edges = {} } = {}) {
  const {
    width, height, tanU, forward, right, up,
  } = plate;
  const centre = plate.direction((box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
  const { azimuth, elevation } = angleOf(centre);
  const local = basisOf(azimuth, elevation);

  // The window's extent in the piece's OWN plane, measured round the whole
  // perimeter and not at its corners: a window wide enough to matter is bent by
  // the projection, and its highest point is in the middle of its top edge.
  let halfU = 0; let halfV = 0;
  const consider = (x, y) => {
    const d = plate.direction(x, y);
    const w = d[0] * local.forward[0] + d[1] * local.forward[1] + d[2] * local.forward[2];
    if (w <= 1e-6) return;
    halfU = Math.max(halfU, Math.abs(
      (d[0] * local.right[0] + d[1] * local.right[1] + d[2] * local.right[2]) / w,
    ));
    halfV = Math.max(halfV, Math.abs(
      (d[0] * local.up[0] + d[1] * local.up[1] + d[2] * local.up[2]) / w,
    ));
  };
  for (let x = box[0]; x <= box[2]; x += 2) { consider(x, box[1]); consider(x, box[3]); }
  for (let y = box[1]; y <= box[3]; y += 2) { consider(box[0], y); consider(box[2], y); }

  // Tangent units one plate texel spans on the axis, which is the sampling rate
  // the photograph actually has. Asking for more would be interpolation
  // pretending to be resolution.
  const step = 2 * tanU / width;
  const four = (v) => Math.max(4, Math.round(v / 4) * 4);
  const tileW = four(2 * halfU / step);
  const tileH = four(2 * halfV / step);

  const a = new Float32Array(tileW * tileH);
  const c3 = new Float32Array(tileW * tileH * 3);
  const one = [0];
  const three = [0, 0, 0];
  // The label is carried through the resampling as a mask read at the same
  // point, so a neighbour's coverage cannot arrive through the filter: a body
  // eight texels away in the plate is a body that is not in this piece at all.
  const mask = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) mask[i] = labels[i] === label ? 1 : 0;

  for (let j = 0; j < tileH; j++) {
    for (let i = 0; i < tileW; i++) {
      const uu = ((i + 0.5) / tileW * 2 - 1) * halfU;
      const vv = (1 - (j + 0.5) / tileH * 2) * halfV;
      const d = [
        local.forward[0] + uu * local.right[0] + vv * local.up[0],
        local.forward[1] + uu * local.right[1] + vv * local.up[1],
        local.forward[2] + uu * local.right[2] + vv * local.up[2],
      ];
      const px = plate.pixel(d);
      if (!px || px[0] < 0 || px[1] < 0 || px[0] >= width || px[1] >= height) continue;
      tap(mask, width, height, 1, px[0], px[1], one);
      if (one[0] <= 0) continue;
      tap(alpha, width, height, 1, px[0], px[1], three);
      const av = three[0] * one[0];
      a[j * tileW + i] = av;
      tap(rgb, width, height, 3, px[0], px[1], three);
      for (let k = 0; k < 3; k++) c3[(j * tileW + i) * 3 + k] = three[k] * one[0];
    }
  }

  // CLOSING AN EDGE THE PLATE RAN OUT ON, and stating the price.
  //
  // Some of these sources carry a veil that leaves the frame: a bank's own low
  // haze runs to both margins, a sheet of cirrus covers the plate corner to
  // corner. There is no window inside such a plate whose border is empty, and
  // the atlas needs one — the gutters, the mip chain and the runtime's clamp
  // all rest on coverage being nought at a tile's edge.
  //
  // So those edges are brought to nothing over a band, and NOT because a fade
  // makes a cut body whole: it does not, which is why a body carrying real
  // cloud at its edge is discarded before it ever reaches here. What is faded
  // is material already under a stated ceiling — a wisp — and the band is
  // degrees wide, so the slope it draws is a fraction of a display level across
  // a whole degree of sky, against the tens of levels a guillotine through a
  // billow draws in one texel. What it removed is measured and travels with the
  // piece.
  const removed = { top: 0, bottom: 0, left: 0, right: 0 };
  if (fade > 0) {
    const ramp = (d, n) => {
      if (n <= 0) return 1;
      const t = Math.min(1, Math.max(0, d / n));
      return t * t * (3 - 2 * t);
    };
    for (let j = 0; j < tileH; j++) {
      for (let i = 0; i < tileW; i++) {
        let k = 1;
        if (edges.left) k = Math.min(k, ramp(i, fade));
        if (edges.right) k = Math.min(k, ramp(tileW - 1 - i, fade));
        if (edges.top) k = Math.min(k, ramp(j, fade));
        if (edges.bottom) k = Math.min(k, ramp(tileH - 1 - j, fade));
        if (k >= 1) continue;
        const o = j * tileW + i;
        const lost = a[o] * (1 - k);
        if (edges.left && i < fade) removed.left += lost;
        else if (edges.right && i >= tileW - fade) removed.right += lost;
        else if (edges.top && j < fade) removed.top += lost;
        else if (edges.bottom) removed.bottom += lost;
        a[o] *= k;
        for (let c = 0; c < 3; c++) c3[o * 3 + c] *= k;
      }
    }
  }

  // Whatever the resampling left standing on the tile's own border, stated
  // rather than assumed.
  let borderPeak = 0;
  let borderSum = 0;
  for (let i = 0; i < tileW; i++) {
    borderPeak = Math.max(borderPeak, a[i], a[(tileH - 1) * tileW + i]);
    borderSum += a[i] + a[(tileH - 1) * tileW + i];
  }
  for (let j = 0; j < tileH; j++) {
    borderPeak = Math.max(borderPeak, a[j * tileW], a[j * tileW + tileW - 1]);
    borderSum += a[j * tileW] + a[j * tileW + tileW - 1];
  }
  const borderAlpha = borderSum / Math.max(1, 2 * (tileW + tileH));

  void forward; void right; void up;
  return {
    width: tileW,
    height: tileH,
    alpha: a,
    rgb: c3,
    // What the closing took, per edge, as a share of the piece's whole
    // coverage. Nought on every edge the plate closed by itself.
    faded: removed,
    azimuth,
    elevation,
    halfU,
    halfV,
    borderAlpha,
    borderPeak,
    degPerTexel: 2 * Math.atan(halfU) / DEG / tileW,
  };
}

/** The sun of a plate, in the local frame of one of its pieces. */
export function sunInPieceFrame(azimuth, elevation, sunAzimuth, sunElevation) {
  const { forward, right, up } = basisOf(azimuth, elevation);
  const s = basisOf(sunAzimuth, sunElevation).forward;
  return [
    s[0] * right[0] + s[1] * right[1] + s[2] * right[2],
    s[0] * up[0] + s[1] * up[1] + s[2] * up[2],
    s[0] * forward[0] + s[1] * forward[1] + s[2] * forward[2],
  ];
}
