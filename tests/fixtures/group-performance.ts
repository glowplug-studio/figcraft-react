import { renderDocument } from "../../src/engine/canvas";
import { newDocument, pageOf, type Document, type DocumentNode, type GroupNode, type RectangleNode } from "../../src/engine/document";

/** In-memory browser rendering fixture; native file node limits do not apply. */
export async function measureGroupedDocument(canvas: HTMLCanvasElement) {
  const empty = newDocument();
  const page = pageOf(empty);
  const nodes: Record<string, DocumentNode> = {};
  const roots: string[] = [];
  let next = 2;
  for (let root = 0; root < 100; root++) {
    const rootId = String(next++), subgroups: string[] = [];
    roots.push(rootId);
    for (let subgroup = 0; subgroup < 10; subgroup++) {
      const subgroupId = String(next++), rectangles: string[] = [];
      subgroups.push(subgroupId);
      for (let item = 0; item < 10; item++) {
        const id = String(next++);
        rectangles.push(id);
        const x = item * 8;
        const node: RectangleNode = { id, kind: "rectangle", parent: subgroupId, name: "Rectangle", x, y: 0, width: 6, height: 6, fill: "#d9d9d9" };
        nodes[id] = node;
      }
      const y = subgroup * 8;
      const node: GroupNode = { id: subgroupId, kind: "group", parent: rootId, name: "Subgroup", children: rectangles, x: 0, y, transform: [1, 0, 0, 1, 0, y], width: 80, height: 8, fill: "transparent" };
      nodes[subgroupId] = node;
    }
    const x = (root % 10) * 96, y = Math.floor(root / 10) * 96;
    const node: GroupNode = { id: rootId, kind: "group", parent: page.id, name: "Root group", children: subgroups, x, y, transform: [1, 0, 0, 1, x, y], width: 80, height: 80, fill: "transparent", opacity: 0.5 };
    nodes[rootId] = node;
  }
  const document: Document = { ...empty, nodes: { ...nodes, [page.id]: { ...page, children: roots } } };
  canvas.width = 1000; canvas.height = 1000;
  const context = canvas.getContext("2d")!;
  const durations: number[] = [];
  for (let frame = 0; frame < 120; frame++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const start = performance.now();
    renderDocument(context, document, 1000, 1000, [], { x: frame, y: frame, width: 80, height: 40 });
    durations.push(performance.now() - start);
  }
  const sorted = durations.slice(10).sort((a, b) => a - b);
  const pixel = Array.from(context.getImageData(2, 2, 1, 1).data);
  const moved = { ...document, nodes: { ...document.nodes, "4": { ...document.nodes["4"], x: 100 } } } as Document;
  renderDocument(context, moved, 1000, 1000);
  const changedBoundsPixel = Array.from(context.getImageData(102, 2, 1, 1).data);
  return {
    rectangles: 10_000, rootGroups: roots.length, subgroups: 1_000,
    measuredFrames: sorted.length, p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1),
    pixel, changedBoundsPixel,
    reactRenderers: canvas.ownerDocument.querySelectorAll("[data-figcraft-editor]").length,
  };
}
