import { renderDocument } from "./canvas";
import { fromRgba8, type Colour } from "./colour";
import type { Document } from "./document";
import type { Point } from "./geometry";
import type { Viewport } from "./viewport";

/** Native canvas/tools/click.rs `eyedrop` (#2189): the colour of one screen pixel centred on the pointer, rendered as the canvas
 * draws it, so an image magnified past 2x gives its own pixel rather than a blend with its neighbours. `point` is in page space. */
export async function sampleCanvasColour(document: Document, view: Viewport, point: Point, owner = globalThis.document): Promise<Colour> {
  const canvas = owner.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  // A 1 x 1 view centred on the point: its top left half a pixel up and to the left.
  const one: Viewport = Object.freeze({ ...view, cx: point.x, cy: point.y, vw: 1, vh: 1 });
  let dirty = true, wake: (() => void) | undefined;
  const invalidate = () => { dirty = true; wake?.(); };
  // Images decode after the first render and ask for another; a few rounds settle them.
  for (let round = 0; round < 12 && dirty; round++) {
    dirty = false;
    await renderDocument(ctx, document, 1, 1, [], undefined, one, undefined, invalidate);
    if (!dirty) await Promise.race([new Promise<void>(resolve => { wake = resolve; }), new Promise<void>(resolve => setTimeout(resolve, round ? 60 : 120))]);
    wake = undefined;
  }
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return fromRgba8(r, g, b, 255);
}
