import { EditorEngine } from "../../src/engine/editor";
import { renderDocument } from "../../src/engine/canvas";
import type { Document, LayerNode } from "../../src/engine/document";
import { strokeReach } from "../../src/engine/stroke-renderer";

export function widthProfilePixels(canvas: HTMLCanvasElement) {
  canvas.width = 240; canvas.height = 200; const context = canvas.getContext("2d")!;
  const paint = (engine: EditorEngine) => {
    const doc = engine.getSnapshot().document, page = doc.nodes[doc.currentPage];
    renderDocument(context, { ...doc, nodes: { ...doc.nodes, [page.id]: { ...page, background: "#ffffff" } } } as Document, 240, 200);
  };
  const pixel = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data];
  const make = (kind: string, props: Record<string, unknown>, x = 40, y = 40) => {
    const engine = new EditorEngine(); engine.execute(`shape.${kind}`, { x, y, width: 100, ...(kind === "line" ? {} : { height: 100 }), props: { fill: null, stroke: "black", strokeWeight: 10, strokeAlign: "center", ...props } }); paint(engine); return engine;
  };
  const wedge = make("line", { widthProfile: "wedge" });
  const taper = { start: pixel(45, 43), end: pixel(135, 43) };
  make("line", { widthProfile: [[0, 0, 2], [1, 0, 2]], startCap: "round", endCap: "round" });
  const sided = { below: pixel(90, 48), above: pixel(90, 38), cap: pixel(37, 44) };
  make("line", { widthProfile: "wedge", dashes: [10, 10] });
  const dash = { ink: pixel(42, 42), gap: pixel(50, 40), narrow: pixel(120, 43) };
  make("line", { widthProfile: [[0, 1], [1, 1]], strokeWeight: 4, dashes: [0, 10], startCap: "round", endCap: "round" });
  const dots = { ink: pixel(50, 40), gap: pixel(55, 40) };
  const styles: Record<string, { inner: number[]; outer: number[]; middle: number[] }> = {};
  for (const align of ["inside", "center", "outside"]) {
    make("rectangle", { widthProfile: [[0, 1], [1, 1]], strokeAlign: align });
    styles[align] = { inner: pixel(90, 42), outer: pixel(90, 37), middle: pixel(90, 90) };
  }
  make("ellipse", { widthProfile: "eye" });
  const ring = { wide: pixel(38, 90), hole: pixel(90, 90), tip: pixel(142, 90) };
  make("line", { widthProfile: "wedge", stroke: "red", opacity: .5, endCap: "triangleArrow" });
  const alpha = { band: pixel(70, 40), overlap: pixel(112, 40), head: pixel(127, 46) };
  make("rectangle", { widthProfile: "eye", strokeSides: [10, 0, 0, 0], strokeAlign: "inside" });
  const sides = { top: pixel(90, 43), right: pixel(137, 90), bottom: pixel(90, 137) };
  make("line", { widthProfile: [[0, 4], [1, 4]], strokeWeight: 10 }, 40, -15);
  const culled = pixel(90, 2);
  const node = wedge.getSnapshot().document.nodes[wedge.getSnapshot().selection[0]] as LayerNode;
  const extremeReach = strokeReach({ ...node, stroke: { ...node.stroke!, widthProfile: { points: [{ t: 0, scale: 1e308, bias: 1e308 }] } } });
  // The native measurement ceiling accepts an eye profile on the largest supported line.
  wedge.execute("node.set", { props: { width: 1e9, strokeWeight: 10, widthProfile: "eye" } }); paint(wedge);
  const maxWidthTaper = pixel(80, 42);
  // Exercise measure refusal separately using an out-of-range document supplied to the renderer.
  const doc=wedge.getSnapshot().document, page=doc.nodes[doc.currentPage];
  renderDocument(context,{...doc,nodes:{...doc.nodes,[page.id]:{...page,background:"#ffffff"},
    [node.id]:{...doc.nodes[node.id],width:1.5e9+1}}} as Document,240,200);
  const fallback = pixel(80, 42);
  return { taper, sided, dash, dots, styles, ring, alpha, sides, culled, extremeReach, maxWidthTaper, fallback };
}
