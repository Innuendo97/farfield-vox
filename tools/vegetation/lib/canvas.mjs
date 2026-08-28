// A small painter's canvas: linear colour, coverage, and nothing else.
//
// The sheets in this folder are drawn with round brush marks along curves
// rather than by filling outlines. A blade of grass is under two texels wide at
// its tip, and whether a polygon that thin covers a texel depends on which side
// of its centre the edge happens to fall, which turns a field of grass into a
// field of dashes. A stamped mark has no such rule: it always leaves the same
// amount of ink for the same amount of blade.

export class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.colour = new Float32Array(width * height * 3);
    this.alpha = new Float32Array(width * height);
  }

  /**
   * One round mark, composited over what is already there.
   *
   * Colour is replaced in proportion to the coverage of the mark rather than
   * blended by the existing alpha: this is a painter laying opaque ink, not a
   * compositor stacking glass. Two blades crossing must leave the colour of the
   * one in front, not the average of the two.
   */
  stamp(cx, cy, radius, colour, ink = 1) {
    const x0 = Math.max(0, Math.floor(cx - radius - 1));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + radius + 1));
    const y0 = Math.max(0, Math.floor(cy - radius - 1));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + radius + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        // A one texel ramp at the rim: enough to antialias the silhouette
        // without softening a blade into a smear.
        const coverage = Math.min(1, Math.max(0, radius + 0.5 - d)) * ink;
        if (coverage <= 0) continue;
        const i = y * this.width + x;
        for (let c = 0; c < 3; c++) {
          const o = i * 3 + c;
          this.colour[o] += (colour[c] - this.colour[o]) * coverage;
        }
        if (coverage > this.alpha[i]) this.alpha[i] = coverage;
      }
    }
  }
}

/**
 * Pushes colour out under the transparent texels.
 *
 * An alpha tested sheet has colour nobody can see wherever it has no coverage,
 * and that colour is black. The mip chain does not know that: it averages the
 * black in with the rim of every blade, and the far half of the ring ends up
 * drawn with a dark outline around each tuft. So the colour is grown outwards
 * before the file is written, and the alpha is left exactly where it was.
 */
export function dilate(canvas, passes) {
  const { width, height } = canvas;
  let filled = new Uint8Array(width * height);
  for (let i = 0; i < filled.length; i++) filled[i] = canvas.alpha[i] > 0.004 ? 1 : 0;

  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint8Array(filled);
    let changed = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (filled[i]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            const j = yy * width + xx;
            if (!filled[j]) continue;
            r += canvas.colour[j * 3];
            g += canvas.colour[j * 3 + 1];
            b += canvas.colour[j * 3 + 2];
            n++;
          }
        }
        if (n === 0) continue;
        canvas.colour[i * 3] = r / n;
        canvas.colour[i * 3 + 1] = g / n;
        canvas.colour[i * 3 + 2] = b / n;
        next[i] = 1;
        changed++;
      }
    }
    filled = next;
    if (changed === 0) break;
  }
}
