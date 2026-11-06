import { EditorEngine } from "../../src/engine/editor";
import { renderDocument } from "../../src/engine/canvas";
import type { Document } from "../../src/engine/document";
import { tracePath } from "../../src/engine/corners";
import { clippedSideStrokePath, roundedSideStrokes } from "../../src/engine/side-stroke";

/** Native render/tests.rs side-edge matrix plus clipping, transparency and culling regressions. */
export function sideStrokePixels(canvas: HTMLCanvasElement) {
  canvas.width = 160; canvas.height = 110; const context = canvas.getContext("2d")!;
  const pixel = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data];
  const paint = (e: EditorEngine) => {
    const doc = e.getSnapshot().document, page = doc.nodes[doc.currentPage];
    renderDocument(context, { ...doc, nodes: { ...doc.nodes, [page.id]: { ...page, background: "#ffffff" } } } as Document, 160, 110);
  };
  const edges = [[[70, 18], [70, 21]], [[131, 50], [128, 50]], [[70, 81], [70, 78]], [[8, 50], [11, 50]]];
  const matrix: { kind: string; align: string; side: number; pixels: number[][] }[] = [];
  for (const kind of ["shape.rectangle", "frame.create"]) for (const align of ["inside", "center", "outside"]) for (let side = 0; side < 4; side++) {
    const e = new EditorEngine();
    e.execute(kind, { x: 10, y: 20, width: 120, height: 60, props: { fill: "white", stroke: "black", strokeSides: [0, 1, 2, 3].map(i => i === side ? 4 : 0), strokeAlign: align, cornerRadius: 16, dashes: [1, 20], strokeJoin: "round" } });
    paint(e); matrix.push({ kind, align, side, pixels: edges.map(edge => { const [x, y] = edge[align === "outside" ? 0 : 1]; return pixel(x, y); }) });
  }
  const left = new EditorEngine(); left.execute("frame.create", { x: 10, y: 10, width: 120, height: 60, props: { fill: "white", stroke: "black", cornerRadius: [0, 8, 8, 0], strokeSides: [0, 0, 0, 4] } }); paint(left);
  const bar = [10, 11, 12, 13, 14].map(x => pixel(x, 40));
  const fitted = new EditorEngine(); fitted.execute("shape.rectangle", { x: 10, y: 10, width: 30, height: 20, props: { fill: null, stroke: "red", cornerRadius: 10, strokeSides: [0, 0, 0, 25], opacity: .5 } }); paint(fitted);
  const fit = { side: pixel(22, 20), hole: pixel(37, 20), above: pixel(34, 10), below: pixel(34, 29) };
  const smooth = new EditorEngine(); smooth.execute("shape.rectangle", { x: 10, y: 20, width: 120, height: 60, props: { fill: null, stroke: "black", cornerRadius: 16, cornerSmoothing: .6, strokeSides: [0, 0, 2, 0] } }); paint(smooth);
  const topPixels: number[][] = [];
  for (let y = 20; y < 50; y++) for (let x = 10; x < 130; x++) if (pixel(x, y)[0] < 250) topPixels.push([x, y, pixel(x, y)[0]]);
  const smoothed = { topInk: topPixels.length, bottom: pixel(70, 79), corner: pixel(10, 79) };
  const geometry = roundedSideStrokes(120, 60, [16, 16, 16, 16], .6, [0, 0, 2, 0], "inside"), ring = new Path2D(), outer = new Path2D();
  tracePath(ring, clippedSideStrokePath(geometry)); tracePath(outer, geometry.outer);
  let stray = 0;
  for (let ix = 0; ix < 1200; ix++) for (let iy = 0; iy < 600; iy++) {
    const x = ix * .1 + .05, y = iy * .1 + .05;
    if (context.isPointInPath(ring, x, y, "evenodd") && (y < 30 || !context.isPointInPath(outer, x, y))) stray++;
  }
  const outside = new EditorEngine(); outside.execute("shape.rectangle", { x: -40, y: 20, width: 20, height: 60, props: { fill: null, stroke: "black", strokeSides: [0, 40, 0, 0], strokeAlign: "outside" } }); paint(outside);
  const culled = pixel(10, 50);
  const frame = new EditorEngine(), parent = String(frame.execute("frame.create", { x: 10, y: 20, width: 120, height: 60, props: { stroke: "red", strokeSides: [0, 0, 0, 4] } }).id);
  frame.execute("shape.rectangle", { parent, x: 0, y: 0, width: 120, height: 60, props: { fill: "blue" } }); paint(frame);
  const order = { stroke: pixel(11, 50), child: pixel(70, 50) };
  const arrow = new EditorEngine(); arrow.execute("shape.arrow", { x: 30, y: 50, width: 80, props: { stroke: "black", strokeWeight: 10, endCap: "triangleArrow", strokeSides: [0, 0, 0, 0] } }); paint(arrow);
  const metadata = { overlap: pixel(95, 50), band: pixel(50, 50), head: pixel(90, 60) };
  return { matrix, bar, fit, smoothed, stray, culled, order, metadata };
}
