// Where the pieces stand, turned into what the runtime draws.
//
// Split out of pack-atlas.mjs, and not for tidiness: a composition is a DESIGN
// and it changes far more often than a fit does. Refitting twenty three pieces
// to rebuild an atlas that is byte for byte the one already on disk, only to
// write a different list of bearings into its manifest, is a quarter of an hour
// spent to change a hundred lines of JSON — and a step that expensive gets
// skipped, which is how a delivered atlas and the composition it is supposed to
// carry come apart. With the rule in one module both the packer and a recompose
// can call it, and there is one silhouette rule rather than two that have to be
// kept equal by hand.
//
// The rule itself is the sprite bake's, to the constant: the window divided into
// cells a couple of degrees across, the cells with nothing in them dropped, what
// is left merged into runs along each row.

const DEG = Math.PI / 180;

const CELL_DEG = 1.6;
const CELL_MAX = 24;
// The coverage a cell has to reach to be drawn at all. Three parts in 255 was
// the sprite bake's, and it is what a cut of that size was worth when it stood
// on a fringe of a body; on a sheet of high cirrus the same three parts are four
// per cent of the zenith's own radiance written along a line three degrees long,
// which is a staircase. One part is where the step goes under the dither the
// composite already adds — and, with the ring below, it is never drawn anyway.
const CELL_LIVE = 1 / 255;
// AND THE UNION IS GROWN BY A CELL, SO THAT IT CUTS NOTHING.
//
// The rule above draws the cells with cloud in them and stops. Outside the union
// nothing is drawn at all, so wherever the coverage on that boundary is not
// nought the frame has a step: axis aligned, a cell long, and the length is what
// makes it read as a staircase instead of as an edge. Measured on the delivered
// pieces the mean coverage along that boundary was 0.33/255 and the worst 12/255
// — half the zenith's own radiance, in one pixel.
//
// So the union takes one ring of cells more than it needs, and the coverage is
// RAMPED to nothing across that ring: `keep` below. The ring is made of cells
// whose own peak is under CELL_LIVE, so what the ramp removes is at most one
// part in 255 of coverage, and what is left outside the quads is exactly
// nought. The cut is not made small — it is not made.
const CELL_GROW = 1;

/**
 * The quads a piece is drawn on: its window, cut back to the cloud in it, and
 * the factor its coverage has to be multiplied by so that the two agree.
 *
 * @param {Float32Array|Uint8Array} alpha coverage, row major, 0..1
 */
export function silhouette(alpha, width, height, spanUDeg, spanVDeg) {
  const cols = Math.max(2, Math.min(CELL_MAX, Math.round(spanUDeg / CELL_DEG)));
  const rows = Math.max(2, Math.min(CELL_MAX, Math.round(spanVDeg / CELL_DEG)));
  const peak = new Float32Array(cols * rows);
  for (let j = 0; j < height; j++) {
    const r = Math.min(rows - 1, Math.floor(j / height * rows));
    for (let i = 0; i < width; i++) {
      const o = r * cols + Math.min(cols - 1, Math.floor(i / width * cols));
      peak[o] = Math.max(peak[o], alpha[j * width + i]);
    }
  }
  const core = new Uint8Array(cols * rows);
  for (let i = 0; i < core.length; i++) core[i] = peak[i] > CELL_LIVE ? 1 : 0;
  let on = core;
  for (let g = 0; g < CELL_GROW; g++) {
    const next = Uint8Array.from(on);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!on[r * cols + c]) continue;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
            next[rr * cols + cc] = 1;
          }
        }
      }
    }
    on = next;
  }
  const parts = [];
  for (let r = 0; r < rows; r++) {
    let start = -1;
    for (let c = 0; c <= cols; c++) {
      const live = c < cols && on[r * cols + c];
      if (live && start < 0) start = c;
      if (!live && start >= 0) {
        parts.push([
          start / cols * 2 - 1, 1 - (r + 1) / rows * 2,
          c / cols * 2 - 1, 1 - r / rows * 2,
        ]);
        start = -1;
      }
    }
  }
  if (!parts.length) parts.push([-1, -1, 1, 1]);
  const area = parts.reduce((t, p) => t + (p[2] - p[0]) * (p[3] - p[1]), 0);

  // The ramp, in cell coordinates: one inside the cells that carry cloud, nought
  // outside the ring, and a smoothstep of the distance to the carrying cells in
  // between. Distance to a cell is the distance to its RECTANGLE, so the ramp
  // runs the same way across a side as it does round a corner.
  const keep = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    const cy = (j + 0.5) / height * rows;
    const r = Math.min(rows - 1, Math.floor(j / height * rows));
    for (let i = 0; i < width; i++) {
      const c = Math.min(cols - 1, Math.floor(i / width * cols));
      if (!on[r * cols + c]) continue;
      if (core[r * cols + c]) { keep[j * width + i] = 1; continue; }
      const cx = (i + 0.5) / width * cols;
      let d = Infinity;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          if (!core[rr * cols + cc]) continue;
          const dx = Math.max(cc - cx, cx - (cc + 1), 0);
          const dy = Math.max(rr - cy, cy - (rr + 1), 0);
          d = Math.min(d, Math.sqrt(dx * dx + dy * dy));
        }
      }
      const t = 1 - Math.min(1, Math.max(0, d));
      keep[j * width + i] = t * t * (3 - 2 * t);
    }
  }

  return {
    parts, areaRatio: area / 4, cells: `${cols}x${rows}`, keep,
  };
}

/**
 * The composition, with everything a piece can answer for itself filled in.
 *
 * The file states the decisions — which pieces stand, at what bearing and
 * height, and where the copies of them go. The angular size and the silhouette
 * are not decisions: they are the piece's own window and the piece's own
 * coverage, so they are read off the bake, and a composition that tried to
 * restate them would be a second place for them to be wrong.
 *
 * @param {object} stand   the composition file, parsed
 * @param {Map<string, {head: object, alpha: ArrayLike<number>}>} pieces by name
 */
export function composeTiles(stand, pieces) {
  const tiles = [];
  for (const t of stand.tiles || []) {
    // A composition tile IS a packed piece: the identifier is the piece's own
    // name, which is what lets the runtime put the two together by one key.
    const p = pieces.get(t.id);
    if (!p) throw new Error(`the composition stands "${t.id}", which this packing does not hold`);
    const spanU = p.head.width * p.head.degPerTexel;
    const spanV = p.head.height * p.head.degPerTexel;
    const sil = silhouette(p.alpha, p.head.width, p.head.height, spanU, spanV);
    tiles.push({
      id: t.id,
      kind: t.kind || 'mass',
      azimuth: t.azimuth,
      elevation: t.elevation,
      // A standing tile may ask for a size other than the one it was cut at, and
      // the runtime honours it. Dropping it here would rebuild every mass at its
      // own scale and quietly undo the grain the composition was fitted for.
      ...(t.scale === undefined ? {} : { scale: t.scale }),
      // The window is stated as the tangent of its half angle, because that is
      // what the quad's own half width is in units of its distance.
      halfU: Number(Math.tan(spanU / 2 * DEG).toFixed(6)),
      halfV: Number(Math.tan(spanV / 2 * DEG).toFixed(6)),
      degPerTexel: p.head.degPerTexel,
      parts: sil.parts.map((q) => q.map((x) => Number(x.toFixed(4)))),
      cells: sil.cells,
      areaRatio: Number(sil.areaRatio.toFixed(4)),
    });
  }
  return { tiles, placements: stand.placements || [] };
}
