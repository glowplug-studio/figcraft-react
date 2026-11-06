import { EditorEngine } from "../../src/engine/editor";
import { renderDocument } from "../../src/engine/canvas";
import type { Document, VectorNode } from "../../src/engine/document";
import { freezeNetwork } from "../../src/engine/vector-network";
import { solidPaint } from "../../src/engine/solid-paint";
import { fromRgba8 } from "../../src/engine/colour";

export function vectorPixels(canvas: HTMLCanvasElement) {
  canvas.width = 260; canvas.height = 220; const ctx = canvas.getContext("2d")!;
  const pixel = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
  const image = () => new Uint8ClampedArray(ctx.getImageData(0, 0, 260, 220).data);
  const paint = (document: Document) => {
    const page = document.nodes[document.currentPage];
    renderDocument(ctx, { ...document, nodes: { ...document.nodes, [page.id]: { ...page, background: "#ffffff" } } } as Document, 260, 220);
  };
  const vector = (path: string, props: Record<string, unknown> = {}, change?: (node: VectorNode) => VectorNode) => {
    const engine = new EditorEngine(), id = String(engine.execute("vector.create", { path, x: 40, y: 40, props }).id), doc = engine.getSnapshot().document;
    const result = change ? { ...doc, nodes: { ...doc.nodes, [id]: Object.freeze(change(doc.nodes[id] as VectorNode)) } } : doc;
    paint(result); return result;
  };
  vector("M0 0H100V100", { fill: "black" }); const openFill = pixel(115, 65);
  vector("M0 100C0 0 100 0 100 100", { fill: null, stroke: "black", strokeWeight: 6 });
  const curve = { ink: pixel(90, 65), interior: pixel(90, 90), endpoint: pixel(40, 135) };
  vector("M0 0H30V30H0Z M60 0L100 100", { fill: "red", stroke: "black", strokeWeight: 6 });
  const separate = { fill: pixel(55, 55), stroke: pixel(120, 90), gap: pixel(90, 90) };
  const ring = "M0 0H100V100H0Z M25 25H75V75H25Z";
  const odd = (node: VectorNode): VectorNode => ({ ...node, network: freezeNetwork({ ...node.network, regions: node.network.regions.map(r => ({ ...r, winding: "evenOdd" })) }) });
  vector(ring, { fill: "black" }, odd); const hole = { ring: pixel(50, 90), hole: pixel(90, 90) };
  const alignments: Record<string, { outer: number[]; inner: number[]; holeOutside: number[]; holeInside: number[] }> = {};
  for (const align of ["inside", "outside"]) {
    vector(ring, { fill: null, stroke: "black", strokeWeight: 10, strokeAlign: align }, odd);
    alignments[align] = { outer: pixel(37, 90), inner: pixel(42, 90), holeOutside: pixel(62, 90), holeInside: pixel(67, 90) };
  }
  vector("M0 0H80V80H0Z M40 0H120V80H40Z", { opacity: .5 }, node => {
    const loops = node.network.regions[0].loops;
    return { ...node, network: freezeNetwork({ ...node.network, regions: [{ loops: [loops[0]], winding: "nonZero", fills: [solidPaint(fromRgba8(255, 0, 0))] }, { loops: [loops[1]], winding: "nonZero", fills: [solidPaint(fromRgba8(0, 0, 255))], paintSpace: { width: -1, height: 0, transform: [0, 0, 0, 0, 1, 2] } }] }) };
  });
  const regions = { first: pixel(60, 80), overlap: pixel(100, 80), second: pixel(150, 80) };
  vector("M0 0H100V100", { fill: null, stroke: "black", strokeWeight: 10, strokeJoin: "bevel" }, node => ({ ...node, network: freezeNetwork({ ...node.network, vertices: node.network.vertices.map((v, i) => ({ ...v, ...(i === 0 ? { cap: "round" as const } : i === 1 ? { join: "round" as const } : { cap: "none" as const }) })) }) }));
  const pointStyles = { start: pixel(36, 40), corner: pixel(143, 37), end: pixel(140, 144) };
  vector("M0 0H100 M0 40H100", { fill: null, stroke: "black", strokeWeight: 10, endCap: "triangleArrow" });
  const arrows = { first: pixel(125, 47), last: pixel(125, 87) };
  const comparisons: Record<string, number> = {};
  for (const [label, props] of Object.entries({ plain: {}, asymmetric: { startCap: "round", endCap: "square" }, dashed: { dashes: [10, 10], startCap: "round", endCap: "square" }, arrow: { endCap: "triangleArrow" }, profile: { widthProfile: "eye" }, brush: { brush: "dots" } })) {
    vector("M0 0H160", { fill: null, stroke: "red", strokeWeight: 10, opacity: .5, ...props }); const actual = image();
    const engine = new EditorEngine(); engine.execute("shape.line", { x: 40, y: 40, width: 160, props: { stroke: "red", strokeWeight: 10, opacity: .5, ...props } }); paint(engine.getSnapshot().document); const expected = image();
    let difference = 0; for (let i = 0; i < actual.length; i++) difference = Math.max(difference, Math.abs(actual[i] - expected[i])); comparisons[label] = difference;
  }
  const cached = vector(ring, { fill: null, stroke: "red", strokeWeight: 10, strokeAlign: "outside", opacity: .5 }, odd);
  let cacheEqual = true;
  for (const shift of [0, .25, 1.4, 20, -.2]) {
    const view = { cx: 130 + shift, cy: 110 + shift / 2, zoom: 1, vw: 260, vh: 220 };
    renderDocument(ctx, cached, 260, 220, [], undefined, view); const warm = image();
    const fresh = canvas.ownerDocument.createElement("canvas"); fresh.width = 260; fresh.height = 220;
    const cold = fresh.getContext("2d")!; renderDocument(cold, cached, 260, 220, [], undefined, view);
    const expected = cold.getImageData(0, 0, 260, 220).data; cacheEqual &&= warm.every((v, i) => v === expected[i]); fresh.width = fresh.height = 0;
  }
  return { openFill, curve, separate, hole, alignments, regions, pointStyles, arrows, comparisons, cacheEqual };
}
