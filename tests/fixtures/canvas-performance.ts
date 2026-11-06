import { renderDocument } from "../../src/engine/canvas";
import { newDocument, pageOf, type Document, type DocumentNode } from "../../src/engine/document";

/** Browser-only representative fixture, not shipped or imported by product code. */
export async function measureLargeDocument(canvas: HTMLCanvasElement, transformed = false, navigating = false) {
  const empty = newDocument();
  const page = pageOf(empty);
  const nodes: Record<string, DocumentNode> = {};
  const ids: string[] = [];
  for (let index = 0; index < 10_000; index++) {
    const id = String(index + 2); ids.push(id);
    const x = (index % 125) * 8, y = Math.floor(index / 125) * 8;
    nodes[id] = { id, kind: "rectangle", parent: page.id, name: "Rectangle", x, y, width: 6, height: 6, fill: "#d9d9d9", ...(transformed ? { transform: [.8660254037844386, .5, -.5, .8660254037844386, x, y] as const } : {}) };
  }
  const document: Document = { ...empty, nodes: { ...nodes, [page.id]: { ...page, children: ids } } };
  canvas.width = 1100; canvas.height = 700;
  const context = canvas.getContext("2d")!;
  const durations: number[] = [];
  for (let frame = 0; frame < 120; frame++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const start = performance.now();
    renderDocument(context, document, 1100, 700, [], { x: frame, y: frame, width: 80, height: 40 }, navigating ? { cx: 550 + frame, cy: 350 - frame, zoom: 1 + frame / 120, vw: 1100, vh: 700 } : undefined);
    durations.push(performance.now() - start);
  }
  if (navigating) renderDocument(context, document, 1100, 700);
  const sorted = durations.slice(10).sort((a,b) => a-b);
  return { rectangles: ids.length, measuredFrames: sorted.length, p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1), pixel: Array.from(context.getImageData(2, 2, 1, 1).data) };
}
