import { inverse, type Affine } from "./affine";
import { rectangleTransform, type Document, type LayerNode } from "./document";
import type { PaintSteps, LayerPaintSteps } from "./image-renderer";
import { patternCell, patternResolution } from "./pattern";

type DrawLayer = (ctx: CanvasRenderingContext2D, doc: Document, node: LayerNode,
  depth: number, nesting: number, scale: number) => PaintSteps;

/** Resolve live layer references while the caller's clip or stroke mask is still active. */
export function* resolveLayerPaints(steps: LayerPaintSteps, doc: Document, depth: number,
  nesting: number, drawLayer: DrawLayer, inspectOpacity = false): PaintSteps {
  for (const [ctx, paint, width, height, space] of steps) {
    if (paint.type === "image") {
      yield [ctx, paint, width, height, space, nesting === 0, inspectOpacity];
      continue;
    }
    if (nesting >= 2 || depth >= 256) continue;
    const source = doc.nodes[paint.source];
    if (!source || source.kind === "page" || source.visible === false) continue;
    const cell = patternCell(paint, source.width, source.height, space?.width ?? width, space?.height ?? height);
    if (!cell) continue;
    const frame = ctx.getTransform();
    if (space) frame.multiplySelf(new DOMMatrix([...space.transform]));
    const resolution = patternResolution(cell, Math.sqrt(Math.abs(frame.a * frame.d - frame.b * frame.c)));
    if (!resolution) continue;
    let unplaced: Affine;
    try { unplaced = inverse(rectangleTransform(source)); } catch { continue; }
    const surface = ctx.canvas.ownerDocument.createElement("canvas");
    surface.width = resolution.width;
    surface.height = resolution.height;
    try {
      const target = surface.getContext("2d")!;
      const { kx, ky } = resolution;
      for (const [x, y] of cell.tiles) {
        target.setTransform(kx, 0, 0, ky, x * kx, y * ky);
        target.scale(cell.scale, cell.scale);
        target.transform(...unplaced);
        yield* drawLayer(target, doc, source, depth + 1, nesting + 1, Math.sqrt(kx*ky)*cell.scale);
      }
      const pattern = ctx.createPattern(surface, "repeat");
      if (!pattern) continue;
      ctx.save();
      try {
        pattern.setTransform(frame.translate(...cell.origin).scale(1 / kx, 1 / ky));
        ctx.resetTransform();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "low";
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      } finally { ctx.restore(); }
    } finally { surface.width = surface.height = 0; }
  }
}
