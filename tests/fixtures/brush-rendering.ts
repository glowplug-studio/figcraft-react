import { EditorEngine } from "../../src/engine/editor";
import { renderDocument } from "../../src/engine/canvas";
import { brushPresets } from "../../src/engine/brush";
import type { Document, LayerNode } from "../../src/engine/document";

export function brushPixels(canvas: HTMLCanvasElement) {
  canvas.width = 260; canvas.height = 220; const context = canvas.getContext("2d")!;
  const pixel = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data];
  const paint = (engine: EditorEngine, doc = engine.getSnapshot().document) => {
    const page = doc.nodes[doc.currentPage];
    renderDocument(context, { ...doc, nodes: { ...doc.nodes, [page.id]: { ...page, background: "#ffffff" } } } as Document, 260, 220);
  };
  const line = (props: Record<string, unknown>, y = 40) => {
    const engine = new EditorEngine(); engine.execute("shape.line", { x: 20, y, width: 200, props: { stroke: "black", strokeWeight: 10, ...props } }); paint(engine); return engine;
  };
  const dots = line({ brush: { preset: "dots", spacing: 2 } }); const scatter = { dot: pixel(30, 40), gap: pixel(40, 40) };
  line({ brush: "taper" }); const taper = { middle: pixel(120, 42), start: pixel(22, 43) };
  const counts: Record<string, number> = {};
  for (const preset of brushPresets) {
    line({ brush: preset.id }); const data = context.getImageData(0, 0, 260, 220).data; let ink = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 128) ink++;
    counts[preset.id] = ink;
  }
  line({ brush: { preset: "dots", spacing: 2 }, widthProfile: [[0, .2], [1, 2]] });
  const pressure = { firstOutside: pixel(30, 43), lastInside: pixel(210, 46) };
  const seeded = line({ brush: { preset: "stars", spacing: 2, sizeJitter: .5, rotationJitter: .5, scatter: 1, seed: 7 } });
  const pixels = new Uint8ClampedArray(context.getImageData(0, 0, 260, 220).data); paint(seeded);
  const repeated = context.getImageData(0, 0, 260, 220).data, repeat = pixels.every((v, i) => v === repeated[i]);
  seeded.execute("node.set", { props: { brush: { preset: "stars", spacing: 2, sizeJitter: .5, rotationJitter: .5, scatter: 1, seed: 8 } } }); paint(seeded);
  const changed = context.getImageData(0, 0, 260, 220).data, different = !pixels.every((v, i) => v === changed[i]);
  const alignments: Record<string, { inside: number[]; outside: number[] }> = {};
  let centreInk: number[] = [];
  for (const align of ["inside", "center", "outside"]) {
    const engine = new EditorEngine(); engine.execute("shape.rectangle", { x: 40, y: 40, width: 100, height: 100, props: { fill: null, stroke: "red", strokeWeight: 10, strokeAlign: align, brush: { preset: "dots", spacing: 2 }, opacity: .5 } }); paint(engine);
    alignments[align] = { inside: pixel(60, 42), outside: pixel(60, 37) };
    if (align === "center") centreInk = pixel(50, 40);
  }
  const side = new EditorEngine(); side.execute("shape.rectangle", { x: 40, y: 40, width: 100, height: 100, props: { fill: null, stroke: "black", strokeWeight: 10, strokeSides: [10, 0, 0, 0], brush: "dots", widthProfile: "eye" } }); paint(side);
  const precedence = { top: pixel(90, 43), right: pixel(137, 90) };
  line({ brush: { preset: "dots", spacing: 2 }, widthProfile: [[0, 4], [1, 4]] }, -10);
  const culled = pixel(30, 2);
  const doc = dots.getSnapshot().document, id = dots.getSnapshot().selection[0], node = doc.nodes[id] as LayerNode;
  const unknown = { ...node, stroke: { ...node.stroke!, brush: { ...node.stroke!.brush!, preset: "future" }, widthProfile: { points: [{ t: 0, scale: 0, bias: 0 }] } } };
  paint(dots, { ...doc, nodes: { ...doc.nodes, [id]: unknown } });
  const fallback = pixel(40, 40);
  line({ brush: { preset: "dots", spacing: 2 }, stroke: "red", opacity: .5, endCap: "triangleArrow" });
  const arrow = { overlap: pixel(210, 40), head: pixel(205, 47) };
  const cached = new EditorEngine(); cached.execute("shape.rectangle", { x: 40, y: 40, width: 100, height: 100, props: { fill: null, stroke: "red", strokeWeight: 10, strokeAlign: "outside", brush: "dots", opacity: .5 } });
  const cachedDoc = cached.getSnapshot().document; let cachePixelsEqual = true;
  for (const shift of [0, .25, 1.4, 20, -.2]) {
    const view = { cx: 130 + shift, cy: 110 + shift / 2, zoom: 1, vw: 260, vh: 220 };
    renderDocument(context, cachedDoc, 260, 220, [], undefined, view);
    const warm = context.getImageData(0, 0, 260, 220).data;
    const fresh = canvas.ownerDocument.createElement("canvas"); fresh.width = 260; fresh.height = 220; const cold = fresh.getContext("2d")!;
    renderDocument(cold, cachedDoc, 260, 220, [], undefined, view); const expected = cold.getImageData(0, 0, 260, 220).data;
    cachePixelsEqual &&= warm.every((v, i) => v === expected[i]); fresh.width = fresh.height = 0;
  }
  return { scatter, taper, counts, pressure, repeat, different, alignments, centreInk, precedence, culled, fallback, arrow, cachePixelsEqual };
}
