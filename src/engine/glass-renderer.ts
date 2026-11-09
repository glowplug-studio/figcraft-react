import { transformPoint, type Affine } from "./affine";
import { type PathCommand } from "./corners";
import type { LayerNode } from "./document";
import { blurPixels } from "./effect-raster";
import type { Effect } from "./effects";
import { glassDepth, glassLensPixels } from "./glass-lens";
import { glassOwnFrame, glassRectangle } from "./glass-rectangle";
import { glassShape } from "./glass-shape";
import { reserveLayerPixels } from "./mask-renderer";
import { pathBounds } from "./vector-path";

type Glass = Extract<Effect, {type: "glass"}>;
const frost = (e: Glass) => Math.min(100, Math.max(0, e.frost));
export function glassBackdropRadius(e: Glass) {
  const depth = Math.min(1000, Math.max(1, e.depth));
  const bend = Math.min(1, Math.max(0, e.refraction)) * depth * (1 + .16 * Math.min(1, Math.max(0, e.dispersion)));
  return frost(e) + bend / 1.5;
}

export function renderGlass(out: CanvasRenderingContext2D, source: CanvasRenderingContext2D,
  node: LayerNode, commands: readonly PathCommand[], path: Path2D, rule: CanvasFillRule, xf: Affine,
  effect: Glass, scale: number, pad: number) {
  const {width, height} = out.canvas, {width: bw, height: bh} = source.canvas;
  const release = reserveLayerPixels(bw, bh, 5);
  if (!release) return;
  const pane = out.canvas.ownerDocument.createElement("canvas");
  try {
    const depth = glassDepth(effect, scale), bevel = Math.min(1024, scale);
    const rect = (node.kind === "frame" || node.kind === "rectangle") && !node.corners?.smoothing
      ? glassRectangle(xf, node.width, node.height, node.corners?.radii ?? [0, 0, 0, 0], bevel, depth + bevel) : undefined;
    const geometry = rect ?? glassShape(out.canvas.ownerDocument, commands, path, rule, xf, width, height, depth, bevel);
    const bounds = pathBounds(commands);
    if (!geometry || !bounds) return;
    const own = glassOwnFrame(xf);
    const centre = transformPoint(own?.matrix ?? xf, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
    const rgba = source.getImageData(0, 0, bw, bh).data;
    const data = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * a / 255);
    }
    blurPixels(data, bw, bh, 4, frost(effect) * scale / 2);
    const pixels = glassLensPixels({data, width: bw, height: bh}, width, height, pad, effect, scale,
      centre.x + (own?.shiftX ?? 0), centre.y + (own?.shiftY ?? 0), geometry);
    for (let i = 0; i < pixels.length; i += 4) {
      const a = pixels[i + 3];
      if (a && a < 255) for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(255 * pixels[i + c] / a);
    }
    pane.width = width; pane.height = height;
    pane.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), width, height), 0, 0);
    out.drawImage(pane, 0, 0);
  } finally { pane.width = pane.height = 0; release(); }
}
