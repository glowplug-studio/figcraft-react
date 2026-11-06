import { EditorEngine } from "../../src/engine/editor";
import { renderDocument } from "../../src/engine/canvas";
import type { Document } from "../../src/engine/document";

/** Browser pixels exercise the real renderer; no canvas or provider mocks. */
export function strokePixels(canvas: HTMLCanvasElement) {
  canvas.width = 240; canvas.height = 200; const context = canvas.getContext("2d")!;
  const engine = () => new EditorEngine();
  const paint = (e: EditorEngine) => {
    const doc = e.getSnapshot().document, page = doc.nodes[doc.currentPage];
    renderDocument(context, { ...doc, nodes: { ...doc.nodes, [page.id]: { ...page, background: "#ffffff" } } } as Document, 240, 200);
  };
  const pixel = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data];
  const line = engine(); line.execute("shape.arrow", { x: 40, y: 80, width: 100, props: { stroke: "red", strokeWeight: 10, endCap: "triangleArrow", opacity: .5 } }); paint(line);
  const alpha = { band: pixel(70, 80), overlap: pixel(125, 80), head: pixel(125, 87) };
  const styles: Record<string, { edge: number[]; inside: number[]; outside: number[] }> = {};
  for (const align of ["inside", "center", "outside"] as const) {
    const e = engine(); e.execute("shape.rectangle", { x: 40, y: 40, width: 100, height: 100, props: { fill: null, stroke: "red", strokeWeight: 10, strokeAlign: align, cornerRadius: 20, cornerSmoothing: .6 } }); paint(e);
    styles[align] = { edge: pixel(42, 90), inside: pixel(90, 90), outside: pixel(35, 90) };
  }
  const frame = engine(), parent = String(frame.execute("frame.create", { x: 40, y: 40, width: 100, height: 100, props: { fill: "white", stroke: "red", strokeWeight: 10 } }).id);
  frame.execute("shape.rectangle", { parent, x: 0, y: 0, width: 100, height: 100, props: { fill: "blue" } }); paint(frame);
  const overlay = { stroke: pixel(42, 90), child: pixel(90, 90) };
  const combined = engine(); combined.execute("shape.rectangle", { x: 40, y: 40, width: 100, height: 100, props: { fill: "blue", stroke: "red", strokeWeight: 10, opacity: .5 } }); paint(combined);
  const stack = { edge: pixel(42, 90), centre: pixel(90, 90) };
  const offscreen = engine(); offscreen.execute("shape.line", { x: -50, y: -3, width: 100, props: { stroke: "black", strokeWeight: 10 } }); paint(offscreen);
  const culled = pixel(20, 0);
  const caps = engine(); caps.execute("shape.rectangle", { x: 20, y: 40, width: 100, height: 100, props: { fill: null, stroke: "black", strokeWeight: 10, strokeAlign: "center", dashes: [15, 15], startCap: "round", endCap: "square" } }); paint(caps);
  const asymmetric = { roundCorner: pixel(46, 44), squareCorner: pixel(69, 44), dash: pixel(58, 40), gap: pixel(43, 40) };
  const cached = engine(); cached.execute("shape.rectangle", { x: 40, y: 40, width: 100, height: 100, props: { fill: null, stroke: "red", strokeWeight: 10, strokeAlign: "outside", cornerRadius: 20, cornerSmoothing: .6 } });
  canvas.width = 100; paint(cached); canvas.width = 240; paint(cached); const resized = pixel(145, 90);
  cached.execute("node.set", { props: { stroke: "blue" } }); paint(cached); const recoloured = pixel(145, 90);
  cached.execute("node.set", { props: { x: 60 } }); paint(cached); const moved = { old: pixel(145, 90), current: pixel(165, 90) };
  return { alpha, styles, overlay, stack, culled, asymmetric, cache: { resized, recoloured, moved } };
}
