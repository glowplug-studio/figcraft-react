import type { Affine } from "./affine";
import { glassOwnFrame } from "./glass-rectangle";
import { reserveLayerPixels } from "./mask-renderer";

/** Skia clips its Béziers to the canvas before antialiasing. Use identical tile
 * boundaries in the shape's device-pixel frame for whole, cropped and cached
 * reads so each visible pixel sees exactly the same clipped contours. */
export function glassCoverage(doc: Document, path: Path2D, rule: CanvasFillRule, xf: Affine,
  x0: number, y0: number, width: number, height: number) {
  const tile = 128;
  const release = reserveLayerPixels(tile, tile, 2);
  if (!release) return;
  const canvas = doc.createElement("canvas");
  try {
    const own = glassOwnFrame(xf), [a,b,c,d,e,f] = own?.matrix ?? xf;
    const left = x0 - (own?.shiftX ?? 0), top = y0 - (own?.shiftY ?? 0);
    const alpha = new Uint8Array(width * height);
    canvas.width = canvas.height = tile;
    const ctx = canvas.getContext("2d", {willReadFrequently:true})!;
    for (let y = Math.floor(top / tile) * tile; y < top + height; y += tile) {
      const sy = Math.max(0, top - y), h = Math.min(tile, top + height - y) - sy;
      for (let x = Math.floor(left / tile) * tile; x < left + width; x += tile) {
        const sx = Math.max(0, left - x), w = Math.min(tile, left + width - x) - sx;
        ctx.resetTransform(); ctx.clearRect(0, 0, tile, tile);
        ctx.setTransform(a,b,c,d,e-x,f-y); ctx.fill(path,rule);
        const data = ctx.getImageData(sx,sy,w,h).data;
        let source = 3;
        for (let j = 0; j < h; j++) {
          let dest = (y + sy - top + j) * width + x + sx - left;
          for (let i = 0; i < w; i++, source += 4) alpha[dest++] = data[source];
        }
      }
    }
    return alpha;
  } finally {canvas.width = canvas.height = 0; release();}
}
